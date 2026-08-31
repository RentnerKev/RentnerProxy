use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::proxy::ProxyValidationError;

pub(super) struct ApiError {
    status: StatusCode,
    error: &'static str,
}

impl ApiError {
    pub(super) fn invalid_configuration() -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            error: "invalid_configuration",
        }
    }

    pub(super) fn validation_failed() -> Self {
        Self {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            error: "validation_failed",
        }
    }

    pub(super) fn payload_too_large() -> Self {
        Self {
            status: StatusCode::PAYLOAD_TOO_LARGE,
            error: "invalid_configuration",
        }
    }

    pub(super) fn runtime_unavailable() -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            error: "runtime_unavailable",
        }
    }

    pub(super) fn apply_failed() -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            error: "apply_failed",
        }
    }

    pub(super) fn unauthorized() -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            error: "unauthorized",
        }
    }

    pub(super) fn not_found() -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            error: "not_found",
        }
    }

    pub(super) fn busy() -> Self {
        Self {
            status: StatusCode::CONFLICT,
            error: "busy",
        }
    }

    pub(super) fn from_validation(error: ProxyValidationError) -> Self {
        match error {
            ProxyValidationError::InvalidConfiguration => Self::invalid_configuration(),
            ProxyValidationError::ValidationFailed => Self::validation_failed(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(serde_json::json!({ "error": self.error })),
        )
            .into_response()
    }
}
