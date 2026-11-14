use crate::user_error::{credential as cred_err, UserError};
use keyring::{Entry, Error as KeyringError};

const CREDENTIAL_SERVICE: &str = "com.tixxin.fuyu.qq-mail";

pub(super) fn credential(email: &str) -> Result<Entry, UserError> {
    Entry::new(&crate::dev_lane::service(CREDENTIAL_SERVICE), email).map_err(cred_err::open)
}

pub(super) fn read_secret(email: &str) -> Result<Option<String>, UserError> {
    match credential(email)?.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(cred_err::read(error)),
    }
}

pub(super) fn delete_secret(email: &str) -> Result<(), UserError> {
    match credential(email)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(cred_err::delete(error)),
    }
}

fn is_domain(value: &str) -> bool {
    value.len() <= 253
        && value.contains('.')
        && value.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
}

pub(super) fn normalize_email(email: &str) -> Result<String, UserError> {
    let email = email.trim().to_ascii_lowercase();
    let valid = email.split_once('@').is_some_and(|(local, domain)| {
        !local.is_empty()
            && local.len() <= 64
            && local
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"._+-".contains(&byte))
            && is_domain(domain)
    });
    if !valid {
        return Err(UserError::new("mail.address", "Enter a valid email address."));
    }
    Ok(email)
}

pub(super) fn imap_host(email: &str) -> String {
    let domain = email.split_once('@').map_or(email, |(_, domain)| domain);
    format!("imap.{domain}")
}

pub(super) const DEFAULT_IMAP_PORT: u16 = 993;

pub(super) fn resolve_host(email: &str, host: Option<&str>) -> Result<String, UserError> {
    let host = match host.map(str::trim).filter(|host| !host.is_empty()) {
        Some(host) => host.to_ascii_lowercase(),
        None => imap_host(email),
    };
    let invalid = || UserError::new("mail.imapServer", "The IMAP server address is not valid: fill in a domain, with a port if needed, such as imap.example.com or imap.example.com:9993.");
    let (name, port) = match host.split_once(':') {
        Some((name, port)) => {
            let port = port.parse::<u16>().ok().filter(|port| *port > 0).ok_or_else(invalid)?;
            (name, port)
        }
        None => (host.as_str(), DEFAULT_IMAP_PORT),
    };
    if !is_domain(name) {
        return Err(invalid());
    }
    Ok(if port == DEFAULT_IMAP_PORT { name.to_string() } else { format!("{name}:{port}") })
}

pub(super) fn server_address(server: &str) -> (&str, u16) {
    match server.split_once(':') {
        Some((name, port)) => (name, port.parse().unwrap_or(DEFAULT_IMAP_PORT)),
        None => (server, DEFAULT_IMAP_PORT),
    }
}
