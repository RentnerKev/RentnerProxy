use super::{Error, Registry, Store};
use tokio::sync::MutexGuard;

// The registry guard fences credential rotation, zone removal and deletion for
// the complete read/modify/verify sequence of one selected DNS record.
pub(in crate::runtime) struct RecordAccess<'a> {
    _state: MutexGuard<'a, Option<Registry>>,
    pub(in crate::runtime) zone_name: String,
    pub(in crate::runtime) token: String,
    pub(in crate::runtime) endpoint: &'a str,
}

impl Store {
    pub(in crate::runtime) async fn record_access(
        &self,
        connection: &str,
        zone: &str,
    ) -> Result<RecordAccess<'_>, Error> {
        let mut state = self.lock().await?;
        let entry = Self::registry(&mut state)?
            .connections
            .iter()
            .find(|entry| entry.metadata.id == connection)
            .ok_or(Error::ConnectionNotFound)?;
        let zone_name = entry
            .metadata
            .zones
            .iter()
            .find(|entry| entry.id == zone)
            .ok_or(Error::ZoneNotPermitted)?
            .name
            .clone();
        let token = self.decrypt(entry)?;
        Ok(RecordAccess {
            _state: state,
            zone_name,
            token,
            endpoint: self.endpoint(),
        })
    }

    #[cfg(test)]
    pub(in crate::runtime) fn fixture(path: std::path::PathBuf, endpoint: String) -> Self {
        let mut store = Self::new(path);
        store.key = Some([7; 32]);
        store.endpoint = Some(endpoint);
        store
    }
}
