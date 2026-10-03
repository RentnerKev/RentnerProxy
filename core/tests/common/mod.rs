use std::{
    fs,
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};

pub const TEST_TOKEN: &str = "controller-integration-token-00000001";
static NEXT_ID: AtomicUsize = AtomicUsize::new(0);

pub fn isolated_command() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_rentnerproxy-controller"));
    command.env_clear();
    if let Some(root) = std::env::var_os("SystemRoot") {
        command.env("SystemRoot", root);
    }
    command
}

pub struct Controller {
    child: Child,
    directory: PathBuf,
    origin: String,
}

impl Controller {
    pub fn start() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "rentnerproxy-binary-test-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&directory).unwrap();
        let mut child = isolated_command()
            .env("RENTNERPROXY_CONTROLLER_LISTEN_ADDR", "127.0.0.1:0")
            .env("RENTNERPROXY_CONTROLLER_TOKEN", TEST_TOKEN)
            .env("RENTNERPROXY_PROXY_STATE_DIR", &directory)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line)
                    && let Some(address) = value["fields"]["local_addr"].as_str()
                {
                    let _ = sender.send(address.to_owned());
                }
            }
        });
        let mut controller = Self {
            child,
            directory,
            origin: String::new(),
        };
        let address = receiver
            .recv_timeout(Duration::from_secs(15))
            .expect("controller listening deadline");
        controller.origin = format!("http://{address}");
        controller
    }

    pub fn url(&self, path: &str) -> String {
        format!("{}{path}", self.origin)
    }
}

impl Drop for Controller {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = fs::remove_dir_all(&self.directory);
    }
}
