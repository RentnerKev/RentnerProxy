mod actions;
mod client;
mod models;

use reqwest::{Client, Url};
use tokio::time::Instant;

pub(in crate::runtime) use models::{Error, ErrorKind, Page, Record, Rrset, Zone};

pub(in crate::runtime) struct Api<'a> {
    client: &'a Client,
    base: &'a Url,
    token: &'a str,
    deadline: Instant,
}

impl<'a> Api<'a> {
    pub(in crate::runtime) fn new(
        client: &'a Client,
        base: &'a Url,
        token: &'a str,
        deadline: Instant,
    ) -> Self {
        Self {
            client,
            base,
            token,
            deadline,
        }
    }
}

#[cfg(test)]
mod tests;
