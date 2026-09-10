# Privacy Policy — DG Segregation

_Last updated: 2026-09-10_

This policy describes the DG Segregation mobile app (Android, package
`com.hymlounge.segregationchecker`) as it actually exists in this release —
not a general template.

## What the app does

DG Segregation lets you enter UN numbers for dangerous goods and checks
whether IMDG segregation rules require them to be kept apart. There is no
account or login — the app has no concept of a user identity beyond the
device it runs on.

## Information you provide

The UN numbers you enter are sent over HTTPS to our Cloudflare Worker API to
perform the segregation check. The app does not intentionally retain your
UN-number inputs as a user history or profile — each check is a stateless
request. We do not ask for or store your name, email, or any other personal
identifier to use the core segregation-check feature.

## Infrastructure providers

- **Cloudflare** provides the API and database infrastructure that answers
  segregation-check requests. See Cloudflare's own privacy policy for how it
  handles infrastructure-level data (e.g. request logs, IP addresses in
  transit).
- **Google AdMob** provides the advertising shown in the app (a single banner
  ad at the bottom of the screen). AdMob's SDK may process information such as
  your IP/network information, app and ad interaction data, diagnostics, and
  device/advertising identifiers, as permitted by your consent choices.
- **Google User Messaging Platform (UMP)** manages the privacy/consent choices
  that apply to advertising in the app (e.g. GDPR consent in the EEA/UK, and
  applicable US state privacy choices).

Each provider's own privacy policy governs how it processes data on its side:

- Cloudflare: <https://www.cloudflare.com/privacypolicy/>
- Google (AdMob / UMP): <https://policies.google.com/privacy>
- Google AdMob's data disclosure: <https://support.google.com/admob/answer/6128543>

## Data in transit

All communication between the app and our backend, and between the app and
Google's advertising services, is transmitted using HTTPS/TLS.

## Retention and deletion

The app itself does not build a user profile or store your UN-number inputs
beyond what is needed to return a single check's result. Because there is no
account, there is nothing in this app for you to request deletion of; any
data retained by Cloudflare or Google is governed by their respective
policies linked above.

## Your choices

Where required (e.g. in the EEA/UK, or an applicable US state), the app
presents Google's consent/privacy-choices form on launch, and a persistent
"Privacy choices" control when required by that form's own rules, letting you
change your advertising consent at any time.

## Contact

`[PRIVACY_CONTACT_EMAIL — REQUIRED BEFORE PUBLIC RELEASE]`

No approved developer/support contact address is currently configured for
this project in this repository. This is a manual release gate — set a real
contact address here (and in the Google Play Console listing) before this
policy is published or the app is submitted. Do not fabricate one.
