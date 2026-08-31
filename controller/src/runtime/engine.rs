use std::{
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    process::Stdio,
    time::Duration,
};

#[cfg(unix)]
use tokio::time::sleep;
use tokio::{
    process::{Child, Command},
    sync::Mutex,
    time::timeout,
};

#[cfg(unix)]
use super::state::ACTIVE_CONFIG_FILE;

#[cfg(unix)]
const PROCESS_SETTLE: Duration = Duration::from_millis(150);
const PROCESS_COMMAND_TIMEOUT: Duration = Duration::from_secs(4);
#[cfg(unix)]
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
#[cfg(unix)]
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

pub(crate) type EngineFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(), EngineError>> + Send + 'a>>;

pub(crate) trait ProxyEngine: Send + Sync {
    fn test_config<'a>(&'a self, config_path: &'a Path) -> EngineFuture<'a>;
    fn start<'a>(&'a self, config_path: &'a Path, expected_revision: &'a str) -> EngineFuture<'a>;
    fn reload<'a>(&'a self, config_path: &'a Path, expected_revision: &'a str) -> EngineFuture<'a>;
    fn shutdown<'a>(&'a self) -> EngineFuture<'a>;
    fn is_running<'a>(&'a self) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EngineError {
    Unavailable,
    CommandFailed,
    TimedOut,
    Unsupported,
}

pub(crate) struct ProcessEngine {
    binary: PathBuf,
    state_dir: PathBuf,
    #[cfg(unix)]
    probe_socket: Option<PathBuf>,
    child: Mutex<Option<Child>>,
}

impl ProcessEngine {
    pub(crate) fn new(binary: PathBuf, state_dir: PathBuf, probe_socket: Option<PathBuf>) -> Self {
        #[cfg(not(unix))]
        let _ = probe_socket;
        Self {
            binary,
            state_dir,
            #[cfg(unix)]
            probe_socket,
            child: Mutex::new(None),
        }
    }

    async fn command(&self, args: &[&str], config_path: &Path) -> Result<(), EngineError> {
        let mut command = Command::new(&self.binary);
        command
            .args(args)
            .arg("-p")
            .arg(&self.state_dir)
            .arg("-c")
            .arg(config_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                EngineError::Unavailable
            } else {
                EngineError::CommandFailed
            }
        })?;
        match timeout(PROCESS_COMMAND_TIMEOUT, child.wait()).await {
            Ok(Ok(status)) if status.success() => Ok(()),
            Ok(Ok(_)) | Ok(Err(_)) => Err(EngineError::CommandFailed),
            Err(_) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                Err(EngineError::TimedOut)
            }
        }
    }

    async fn child_running(&self) -> bool {
        let mut child = self.child.lock().await;
        let exited = match child.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(None) => false,
                Ok(Some(_)) | Err(_) => true,
            },
            None => return false,
        };
        if exited {
            *child = None;
            false
        } else {
            true
        }
    }

    #[cfg(unix)]
    async fn probe_revision(&self, expected_revision: &str) -> Result<(), EngineError> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::UnixStream;

        let Some(path) = &self.probe_socket else {
            return Err(EngineError::Unsupported);
        };
        let expected_body = format!("{expected_revision}\n");
        let probe = async {
            loop {
                if let Ok(mut stream) = UnixStream::connect(path).await {
                    let request = b"GET /__rentnerproxy_runtime_probe HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";
                    if stream.write_all(request).await.is_ok() {
                        let mut response = Vec::with_capacity(512);
                        let mut limited_response = stream.take(4_096);
                        if limited_response.read_to_end(&mut response).await.is_ok()
                            && response.starts_with(b"HTTP/1.1 200")
                            && response.ends_with(expected_body.as_bytes())
                        {
                            return Ok(());
                        }
                    }
                }
                sleep(Duration::from_millis(50)).await;
            }
        };
        timeout(PROBE_TIMEOUT, probe)
            .await
            .map_err(|_| EngineError::TimedOut)?
    }

    #[cfg(unix)]
    async fn start_unix(
        &self,
        config_path: &Path,
        expected_revision: &str,
    ) -> Result<(), EngineError> {
        if self.child_running().await {
            return self.probe_revision(expected_revision).await;
        }
        let mut command = Command::new(&self.binary);
        command
            .arg("-p")
            .arg(&self.state_dir)
            .arg("-c")
            .arg(config_path)
            .arg("-g")
            .arg("daemon off;")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        command.process_group(0);
        let child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                EngineError::Unavailable
            } else {
                EngineError::CommandFailed
            }
        })?;
        *self.child.lock().await = Some(child);
        let acknowledgement = async {
            sleep(PROCESS_SETTLE).await;
            if !self.child_running().await {
                return Err(EngineError::CommandFailed);
            }
            self.probe_revision(expected_revision).await
        }
        .await;
        if acknowledgement.is_err() {
            self.terminate_child().await;
        }
        acknowledgement
    }

    #[cfg(unix)]
    async fn reload_unix(
        &self,
        config_path: &Path,
        expected_revision: &str,
    ) -> Result<(), EngineError> {
        if !self.child_running().await {
            return self.start_unix(config_path, expected_revision).await;
        }
        self.command(&["-s", "reload"], config_path).await?;
        if !self.child_running().await {
            return Err(EngineError::CommandFailed);
        }
        self.probe_revision(expected_revision).await
    }

    #[cfg(unix)]
    async fn shutdown_unix(&self) -> Result<(), EngineError> {
        let active = self.state_dir.join(ACTIVE_CONFIG_FILE);
        if !self.child_running().await {
            return Ok(());
        }
        let signal = self.command(&["-s", "quit"], &active).await;
        if let Err(error) = signal {
            self.terminate_child().await;
            return Err(error);
        }
        self.wait_for_child_exit().await
    }

    #[cfg(unix)]
    async fn terminate_child(&self) {
        let Some(mut child) = self.child.lock().await.take() else {
            return;
        };
        if let Some(process_id) = child.id() {
            self.kill_process_group(process_id);
        }
        let _ = child.start_kill();
        let _ = timeout(SHUTDOWN_TIMEOUT, child.wait()).await;
    }

    #[cfg(unix)]
    async fn wait_for_child_exit(&self) -> Result<(), EngineError> {
        let Some(mut child) = self.child.lock().await.take() else {
            return Ok(());
        };
        match timeout(SHUTDOWN_TIMEOUT, child.wait()).await {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(_)) => Err(EngineError::CommandFailed),
            Err(_) => {
                if let Some(process_id) = child.id() {
                    self.kill_process_group(process_id);
                }
                let _ = child.start_kill();
                match timeout(SHUTDOWN_TIMEOUT, child.wait()).await {
                    Ok(Ok(_)) => Err(EngineError::TimedOut),
                    Ok(Err(_)) | Err(_) => Err(EngineError::CommandFailed),
                }
            }
        }
    }

    #[cfg(unix)]
    fn kill_process_group(&self, process_id: u32) {
        let Ok(process_id) = i32::try_from(process_id) else {
            return;
        };
        // SAFETY: start_unix assigns the master to a process group with this positive ID.
        // Negating that ID sends SIGKILL only to the controller-owned process group.
        unsafe {
            libc::kill(-process_id, libc::SIGKILL);
        }
    }
}

impl ProxyEngine for ProcessEngine {
    fn test_config<'a>(&'a self, config_path: &'a Path) -> EngineFuture<'a> {
        Box::pin(async move { self.command(&["-t"], config_path).await })
    }

    fn start<'a>(&'a self, config_path: &'a Path, expected_revision: &'a str) -> EngineFuture<'a> {
        Box::pin(async move {
            #[cfg(unix)]
            {
                self.start_unix(config_path, expected_revision).await
            }
            #[cfg(not(unix))]
            {
                let _ = (config_path, expected_revision);
                Err(EngineError::Unsupported)
            }
        })
    }

    fn reload<'a>(&'a self, config_path: &'a Path, expected_revision: &'a str) -> EngineFuture<'a> {
        Box::pin(async move {
            #[cfg(unix)]
            {
                self.reload_unix(config_path, expected_revision).await
            }
            #[cfg(not(unix))]
            {
                let _ = (config_path, expected_revision);
                Err(EngineError::Unsupported)
            }
        })
    }

    fn shutdown<'a>(&'a self) -> EngineFuture<'a> {
        Box::pin(async move {
            #[cfg(unix)]
            {
                self.shutdown_unix().await
            }
            #[cfg(not(unix))]
            {
                Ok(())
            }
        })
    }

    fn is_running<'a>(&'a self) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(async move { self.child_running().await })
    }
}
