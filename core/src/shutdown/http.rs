use axum::{Router, middleware, response::IntoResponse};
use std::{
    future::Future,
    io,
    net::SocketAddr,
    pin::Pin,
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    net::{TcpListener, TcpStream},
    sync::watch,
    time::{Instant, timeout_at},
};

#[cfg(test)]
#[path = "../../tests/private/http_drain.rs"]
mod tests;

// Closing only the listener leaves Axum's spawned connections (including SSE)
// alive. Every connection and pending handler observes the forced-drain fence.
struct DrainIo {
    stream: TcpStream,
    cancelled: Pin<Box<dyn Future<Output = ()> + Send>>,
    stopped: bool,
}

async fn cancelled(mut receiver: watch::Receiver<bool>) {
    while !*receiver.borrow_and_update() {
        if receiver.changed().await.is_err() {
            return;
        }
    }
}

impl DrainIo {
    fn check(&mut self, cx: &mut Context<'_>) -> io::Result<()> {
        if self.stopped || self.cancelled.as_mut().poll(cx).is_ready() {
            self.stopped = true;
            Err(io::Error::from(io::ErrorKind::ConnectionAborted))
        } else {
            Ok(())
        }
    }
}

impl AsyncRead for DrainIo {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        self.check(cx)?;
        Pin::new(&mut self.stream).poll_read(cx, buffer)
    }
}

impl AsyncWrite for DrainIo {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<io::Result<usize>> {
        self.check(cx)?;
        Pin::new(&mut self.stream).poll_write(cx, bytes)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.check(cx)?;
        Pin::new(&mut self.stream).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}

struct DrainListener {
    listener: TcpListener,
    cancellation: watch::Receiver<bool>,
}

impl axum::serve::Listener for DrainListener {
    type Io = DrainIo;
    type Addr = SocketAddr;
    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        let (stream, address) = axum::serve::Listener::accept(&mut self.listener).await;
        (
            DrainIo {
                stream,
                cancelled: Box::pin(cancelled(self.cancellation.clone())),
                stopped: false,
            },
            address,
        )
    }
    fn local_addr(&self) -> io::Result<Self::Addr> {
        self.listener.local_addr()
    }
}

pub(crate) async fn serve_with_drain(
    listener: TcpListener,
    router: Router,
    shutdown: impl Future<Output = Instant> + Send + 'static,
    drain: Duration,
) -> (io::Result<()>, Instant) {
    let (cancel, receiver) = watch::channel(false);
    let requests = receiver.clone();
    let router = router.layer(middleware::from_fn(move |request, next: middleware::Next| {
        let receiver = requests.clone();
        async move {
            tokio::select! {
                response = next.run(request) => response,
                _ = cancelled(receiver) => axum::http::StatusCode::SERVICE_UNAVAILABLE.into_response(),
            }
        }
    }));
    let (signal, started) = tokio::sync::oneshot::channel();
    let server = axum::serve(
        DrainListener {
            listener,
            cancellation: receiver,
        },
        router,
    )
    .with_graceful_shutdown(async move {
        let _ = signal.send(shutdown.await);
    });
    let server = std::future::IntoFuture::into_future(server);
    tokio::pin!(server);
    let deadline = tokio::select! {
        result = &mut server => return (result, Instant::now() + super::SHUTDOWN_TIMEOUT),
        deadline = started => deadline.unwrap_or_else(|_| Instant::now()),
    };
    let drain_deadline = (Instant::now() + drain).min(deadline);
    match timeout_at(drain_deadline, &mut server).await {
        Ok(result) => (result, deadline),
        Err(_) => {
            cancel.send_replace(true);
            tracing::warn!(
                stage = "http_drain",
                "HTTP drain deadline exceeded; cancelling connections"
            );
            // Cancellation owns connection I/O and handler futures; do not wait
            // indefinitely for a peer or body producer before runtime cleanup.
            (Ok(()), deadline)
        }
    }
}
