use super::{
    Error, Reference, Store,
    models::{ConsumerType, Usage},
    validation,
};

impl Store {
    // Reserve additions before saving DDNS configuration, then prune only after
    // its authoritative file commits. A crash can leave extra reservations,
    // never an unprotected live consumer. Startup reconciles this type only.
    pub(in crate::runtime) async fn ddns_references(
        &self,
        references: &[Reference],
        retain_existing: bool,
        strict: bool,
    ) -> Result<(), Error> {
        let mut state = self.lock().await?;
        let registry = Self::registry(&mut state)?;
        let mut next = registry.clone();
        let mut changed = false;
        if !retain_existing {
            for entry in &mut next.connections {
                let before = entry.metadata.references.len();
                entry.metadata.references.retain(|usage| {
                    usage.consumer.r#type != ConsumerType::Ddns
                        || references.iter().any(|reference| {
                            reference.connection_id == entry.metadata.id
                                && reference.zone_id == usage.zone_id
                                && reference.consumer == usage.consumer
                        })
                });
                changed |= before != entry.metadata.references.len();
            }
        }
        for reference in references {
            validation::reference(reference)?;
            if reference.consumer.r#type != ConsumerType::Ddns {
                return Err(Error::InvalidInput);
            }
            let Some(entry) = next
                .connections
                .iter_mut()
                .find(|entry| entry.metadata.id == reference.connection_id)
            else {
                if strict {
                    return Err(Error::ConnectionNotFound);
                }
                continue;
            };
            if !entry
                .metadata
                .zones
                .iter()
                .any(|zone| zone.id == reference.zone_id)
            {
                if strict {
                    return Err(Error::ZoneNotPermitted);
                }
                continue;
            }
            if strict {
                self.decrypt(entry)?;
            }
            let usage = Usage {
                zone_id: reference.zone_id.clone(),
                consumer: reference.consumer.clone(),
            };
            if !entry.metadata.references.contains(&usage) {
                entry.metadata.references.push(usage);
                changed = true;
            }
        }
        if changed {
            for entry in &next.connections {
                validation::metadata(&entry.metadata)?;
            }
            self.persist(&next)?;
            *registry = next;
        }
        Ok(())
    }
}
