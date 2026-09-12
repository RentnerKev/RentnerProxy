use axum::{body::Bytes, http::Request};
use http_body_util::{BodyExt, Full, Limited};
use hyper_util::rt::TokioIo;
use std::{
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncWrite, AsyncWriteExt},
    process::{Child, Command},
    sync::Mutex,
    task::JoinHandle,
    time::{sleep, timeout},
};

const API_TIMEOUT: Duration = Duration::from_secs(10);
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_CONTROL_RESPONSE_BYTES: usize = 4_096;

pub(crate) type EngineFuture<'a> =
    Pin<Box<dyn Future<Output = Result<(), EngineError>> + Send + 'a>>;

pub(crate) trait ProxyEngine: Send + Sync {
    fn start<'a>(&'a self, configuration: &'a str, expected_revision: &'a str) -> EngineFuture<'a>;
    fn load<'a>(&'a self, configuration: &'a str) -> EngineFuture<'a>;
    fn probe<'a>(&'a self, expected_revision: &'a str) -> EngineFuture<'a>;
    fn shutdown<'a>(&'a self) -> EngineFuture<'a>;
    fn is_running<'a>(&'a self) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EngineError {
    Unavailable,
    CommandFailed,
    Rejected,
    InvalidResponse,
    TimedOut,
}

pub(crate) struct CaddyProcess {
    binary: PathBuf,
    state_dir: PathBuf,
    admin_socket: PathBuf,
    probe_socket: PathBuf,
    child: Mutex<Option<Child>>,
}

impl CaddyProcess {
    pub(crate) fn new(binary: PathBuf, state_dir: PathBuf) -> Self {
        Self {
            binary,
            admin_socket: state_dir.join("caddy-admin.sock"),
            probe_socket: state_dir.join("runtime-probe.sock"),
            state_dir,
            child: Mutex::new(None),
        }
    }

    async fn child_running(&self) -> bool {
        let mut slot = self.child.lock().await;
        match slot.as_mut().map(Child::try_wait) {
            Some(Ok(None)) => true,
            _ => {
                *slot = None;
                false
            }
        }
    }

    async fn request(
        &self,
        socket: &Path,
        fallback_port: u16,
        method: &'static str,
        path: &'static str,
        body: &str,
    ) -> Result<ControlResponse, EngineError> {
        let operation = async {
            #[cfg(unix)]
            {
                let _ = fallback_port;
                let stream = tokio::net::UnixStream::connect(socket)
                    .await
                    .map_err(|_| EngineError::Unavailable)?;
                exchange(stream, "localhost", method, path, body).await
            }
            #[cfg(not(unix))]
            {
                let _ = socket;
                let stream =
                    tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, fallback_port))
                        .await
                        .map_err(|_| EngineError::Unavailable)?;
                exchange(
                    stream,
                    &format!("127.0.0.1:{fallback_port}"),
                    method,
                    path,
                    body,
                )
                .await
            }
        };
        timeout(API_TIMEOUT, operation)
            .await
            .map_err(|_| EngineError::TimedOut)?
    }

    async fn verify_revision(&self, revision: &str) -> Result<(), EngineError> {
        let expected = format!("{revision}\n");
        let operation = async {
            loop {
                if !self.child_running().await {
                    return Err(EngineError::Unavailable);
                }
                if let Ok(response) = self
                    .request(
                        &self.probe_socket,
                        2_020,
                        "GET",
                        "/__rentnerproxy_runtime_probe",
                        "",
                    )
                    .await
                    && response.status == 200
                    && response.body == expected.as_bytes()
                {
                    return Ok(());
                }
                sleep(Duration::from_millis(50)).await;
            }
        };
        timeout(PROBE_TIMEOUT, operation)
            .await
            .map_err(|_| EngineError::TimedOut)?
    }

    async fn start_owned(&self, configuration: &str, revision: &str) -> Result<(), EngineError> {
        if self.child_running().await {
            return self.verify_revision(revision).await;
        }
        let mut command = Command::new(&self.binary);
        command
            .args(["run", "--config", "-"])
            .current_dir(&self.state_dir)
            .env_clear()
            .env("XDG_CONFIG_HOME", self.state_dir.join("caddy/config"))
            .env("XDG_DATA_HOME", self.state_dir.join("caddy/data"))
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .kill_on_drop(true);
        #[cfg(unix)]
        command.process_group(0);
        #[cfg(windows)]
        {
            command.creation_flags(0x0800_0000);
            if let Some(system_root) = std::env::var_os("SystemRoot") {
                command.env("SystemRoot", system_root);
            }
        }
        let mut child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                EngineError::Unavailable
            } else {
                EngineError::CommandFailed
            }
        })?;
        let mut stdin = child.stdin.take().ok_or(EngineError::CommandFailed)?;
        *self.child.lock().await = Some(child);
        let result = async {
            stdin
                .write_all(configuration.as_bytes())
                .await
                .map_err(|_| EngineError::CommandFailed)?;
            stdin
                .shutdown()
                .await
                .map_err(|_| EngineError::CommandFailed)?;
            drop(stdin);
            self.verify_revision(revision).await
        }
        .await;
        if result.is_err() {
            self.terminate_child().await;
        }
        result
    }

    async fn terminate_child(&self) {
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.start_kill();
            let _ = timeout(SHUTDOWN_TIMEOUT, child.wait()).await;
        }
    }
}

impl ProxyEngine for CaddyProcess {
    fn start<'a>(&'a self, configuration: &'a str, revision: &'a str) -> EngineFuture<'a> {
        Box::pin(self.start_owned(configuration, revision))
    }
    fn load<'a>(&'a self, configuration: &'a str) -> EngineFuture<'a> {
        Box::pin(async move {
            if !self.child_running().await {
                return Err(EngineError::Unavailable);
            }
            let response = self
                .request(&self.admin_socket, 2_019, "POST", "/load", configuration)
                .await?;
            match response.status {
                200 if response.body.is_empty() => Ok(()),
                400..=499 => Err(EngineError::Rejected),
                _ => Err(EngineError::InvalidResponse),
            }
        })
    }
    fn probe<'a>(&'a self, revision: &'a str) -> EngineFuture<'a> {
        Box::pin(self.verify_revision(revision))
    }
    fn shutdown<'a>(&'a self) -> EngineFuture<'a> {
        Box::pin(async move {
            if !self.child_running().await {
                return Ok(());
            }
            let result = self
                .request(&self.admin_socket, 2_019, "POST", "/stop", "")
                .await;
            if !matches!(result, Ok(ControlResponse { status: 200, .. })) {
                self.terminate_child().await;
                return Err(EngineError::CommandFailed);
            }
            let mut slot = self.child.lock().await;
            let Some(child) = slot.as_mut() else {
                return Ok(());
            };
            if !matches!(timeout(SHUTDOWN_TIMEOUT, child.wait()).await, Ok(Ok(_))) {
                drop(slot);
                self.terminate_child().await;
                return Err(EngineError::TimedOut);
            }
            *slot = None;
            Ok(())
        })
    }
    fn is_running<'a>(&'a self) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(self.child_running())
    }
}

struct ControlResponse {
    status: u16,
    body: Bytes,
}

#[cfg(test)]
#[path = "../tests/caddy_transport.rs"]
mod tests;

struct ConnectionTask(JoinHandle<()>);
impl Drop for ConnectionTask {
    fn drop(&mut self) {
        self.0.abort();
    }
}

async fn exchange<S>(
    stream: S,
    host: &str,
    method: &'static str,
    path: &'static str,
    body: &str,
) -> Result<ControlResponse, EngineError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
        .await
        .map_err(|_| EngineError::InvalidResponse)?;
    let _connection = ConnectionTask(tokio::spawn(async move {
        let _ = connection.await;
    }));
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Host", host)
        .header("Content-Type", "application/json")
        .header("Connection", "close")
        .body(Full::new(Bytes::copy_from_slice(body.as_bytes())))
        .map_err(|_| EngineError::InvalidResponse)?;
    let response = sender
        .send_request(request)
        .await
        .map_err(|_| EngineError::InvalidResponse)?;
    let status = response.status().as_u16();
    let body = Limited::new(response.into_body(), MAX_CONTROL_RESPONSE_BYTES)
        .collect()
        .await
        .map_err(|_| EngineError::InvalidResponse)?
        .to_bytes();
    Ok(ControlResponse { status, body })
}
