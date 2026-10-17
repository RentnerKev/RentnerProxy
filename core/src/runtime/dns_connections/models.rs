use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Error {
    InvalidInput,
    ConnectionNotFound,
    ConnectionConflict,
    ConnectionInUse,
    ConnectionLimit,
    TokenRequired,
    ZoneNotPermitted,
    ZoneLimit,
    ProviderUnauthorized,
    ProviderUnavailable,
    ProviderRateLimited,
    StoreUnavailable,
    CredentialsUnavailable,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Zone {
    pub(crate) id: String,
    pub(crate) name: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(deny_unknown_fields)]
pub(crate) struct Consumer {
    pub(crate) r#type: ConsumerType,
    pub(crate) id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ConsumerType {
    Dns01,
    Ddns,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Usage {
    pub(crate) zone_id: String,
    pub(crate) consumer: Consumer,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Reference {
    pub(crate) connection_id: String,
    pub(crate) zone_id: String,
    pub(crate) consumer: Consumer,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct Metadata {
    pub(crate) id: String,
    pub(crate) provider: String,
    pub(crate) ownership: String,
    pub(crate) name: String,
    pub(crate) created_by_user_id: String,
    pub(crate) revision: u32,
    pub(crate) zones: Vec<Zone>,
    #[serde(default)]
    pub(crate) references: Vec<Usage>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct SaveRequest {
    pub(crate) expected_revision: u32,
    pub(crate) name: String,
    pub(crate) api_token: Option<String>,
    pub(crate) zone_ids: Vec<String>,
    pub(crate) actor_user_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct TestRequest {
    pub(crate) connection_id: Option<String>,
    pub(crate) api_token: Option<String>,
    pub(crate) zone_ids: Option<Vec<String>>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct DeleteRequest {
    pub(crate) expected_revision: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TestResult {
    pub(crate) zones: Vec<Zone>,
    pub(crate) selected_zone_ids: Vec<String>,
    pub(crate) checked_at: String,
    pub(crate) dns_write_verified: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ValidatedReference {
    pub(crate) reference: Reference,
    pub(crate) revision: u32,
    pub(crate) zone: Zone,
}
