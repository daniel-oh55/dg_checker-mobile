# Android Release — DG Segregation MVP

Release notes and manual gates for the Google Play Android MVP. This is not a
full compliance manual — just what this specific app's release actually
needs, kept current with what the code does.

## Build profiles

| Profile       | Ads               | AdMob App ID          | Backend                    |
| ------------- | ----------------- | ---------------------- | -------------------------- |
| `development` | Google test ads   | Google test App ID     | production API (v3)        |
| `preview`     | Google test ads   | Google test App ID     | production API (v3)        |
| `production`  | Real ads required | Real App ID required   | production API (v3)        |

Test-vs-production selection is deterministic and build-time only (see
`mobile/app.config.ts`): it keys off `EAS_BUILD_PROFILE === 'production'`, set
automatically by EAS during a cloud build. A developer cannot accidentally
produce a preview build wired to production ad units.

## UMP consent gating (native app measurement + ProGuard)

`mobile/app.config.ts` configures the `react-native-google-mobile-ads` plugin
with `delayAppMeasurementInit: true`. This defers Google Mobile Ads' native
app measurement until the app actually initializes Mobile Ads — which
`mobile/src/ads/useAdsConsent.ts` only does once the UMP SDK reports
`canRequestAds: true`. Without this flag, native measurement can start before
consent has been gathered.

The same config also applies the `expo-build-properties` plugin with
`android.extraProguardRules` set to the ProGuard keep rule the UMP SDK
requires:

```
-keep class com.google.android.gms.internal.consent_sdk.** { *; }
```

This is additive only — it does not enable R8/minification and does not touch
`compileSdk`/`targetSdk`/Kotlin versions.

`useAdsConsent` requests updated consent info on every launch and shows the
consent form if required. If that gathering fails (e.g. no network), it falls
back to the UMP SDK's previous-session state via `AdsConsent.getConsentInfo()`
rather than assuming no consent was ever given; if even that call fails, it
fails closed (`canRequestAds: false`). `PrivacyFooter`'s "Privacy choices"
action no longer manages UMP state itself — it calls the hook's
`showPrivacyOptions()`, which shows the privacy-options form and then
re-reads `AdsConsent.getConsentInfo()` to refresh `canRequestAds` (gating the
banner) and `privacyOptionsRequired`.

## `react-native-google-mobile-ads` is pinned to an exact version

`mobile/package.json` pins `react-native-google-mobile-ads` to the exact
version `16.0.0` (not a `^` range). Versions `16.4.0`+ bundle
`com.google.android.gms:play-services-ads:25.4.0`, whose Kotlin metadata
(2.3.0) the Kotlin compiler this Expo SDK/React Native version resolves to
(2.1.20, metadata 2.1.0) cannot read — the release Gradle build fails with:

```
Execution failed for task ':react-native-google-mobile-ads:compileReleaseKotlin'.
> Module was compiled with an incompatible version of Kotlin. The binary
  version of its metadata is 2.3.0, expected version is 2.1.0.
```

`16.0.0` bundles `play-services-ads:24.6.0`, which predates that bump and
builds cleanly (verified via an EAS preview build from this branch). Do not
bump this package past `16.x` without first confirming its bundled
`play-services-ads` version against a real Android release build — check
`sdkVersions.android.googleMobileAds` in the candidate version's
`package.json` before upgrading.

## Required environment variables for a production build

Set these in the EAS **production** environment (`eas env:create --environment production ...`)
before running `eas build --platform android --profile production`:

- `ADMOB_ANDROID_APP_ID` — the real AdMob Android App ID (native config,
  consumed by `app.config.ts`).
- `EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID` — the real banner ad unit ID.
- `EXPO_PUBLIC_PRIVACY_POLICY_URL` — the public HTTPS privacy-policy URL.

If any of these is missing, `app.config.ts` throws and the production build
fails at config-resolution time — it will not silently ship Google test IDs
or an empty privacy-policy link. Confirmed by running:

```bash
cd mobile
EAS_BUILD_PROFILE=production npx expo config --type public
```

with each variable unset in turn.

## Manual AdMob console gates (cannot be done from code)

- [ ] Create/confirm an AdMob app for Android package
      `com.hymlounge.segregationchecker`.
- [ ] Obtain the Android AdMob App ID → set as `ADMOB_ANDROID_APP_ID`.
- [ ] Create one **adaptive/anchored banner** ad unit (no interstitial,
      rewarded, app-open, or native — MVP is banner-only) → set as
      `EXPO_PUBLIC_ADMOB_ANDROID_BANNER_ID`.
- [ ] Configure Privacy & Messaging (UMP) in the AdMob console for the
      applicable regions (EEA/UK GDPR message, US states message as needed).
- [ ] Connect the three variables above to the EAS `production` environment.
- [ ] No mediation networks — Google AdMob only for this MVP.

## Google Play Console gates

- [ ] **App contains ads: YES.**
- [ ] No login/account in this app — no "account deletion" data-safety item
      applies because no account exists.
- [ ] Advertising ID usage/declaration must match what's actually shipped:
      the Google Mobile Ads SDK is included and the AD_ID permission is no
      longer blocked (see `mobile/app.config.ts` — `blockedPermissions` was
      removed when AdMob was integrated).
- [ ] Data Safety section must declare Google Mobile Ads SDK data handling
      (advertising ID, diagnostics, app interactions) per Google's current
      published data-disclosure documentation for that SDK — verify against
      <https://developers.google.com/admob/android/privacy/play-data-disclosure>
      at submission time rather than assuming this list is exhaustive.
- [ ] Privacy Policy URL must be entered in Play Console **and** reachable
      from the app footer (`EXPO_PUBLIC_PRIVACY_POLICY_URL`).
- [ ] Target audience / content rating questionnaire must be completed by the
      developer in Play Console (not something this PR can do).
- [ ] Production banner ad unit and AdMob App ID must be real — a production
      build fails outright if they're missing (see above), but Play Console
      review is still the final check that no test ID reached a real listing.

## Release gate: IMO / authorized IMDG data-rights

**Hard public-release gate — do not weaken or remove.**

The code and AAB may be built and used for internal/physical-device QA. But
this app must **not** be submitted to the public Google Play production
track unless the data-rights/publication permission for the authorized IMDG
source data has been explicitly confirmed by the project owner. This is a
licensing/legal gate, not a code defect, and nothing in this PR satisfies it.

## Physical-device QA checklist (Galaxy S23 Ultra)

- [ ] App starts without crashing.
- [ ] Production API returns v3 data (`schemaVersion: "3"`,
      `version: "authorized-source-v3"`).
- [ ] 2-input check works.
- [ ] Multi-input batch (up to 10) works.
- [ ] Proper shipping name (PSN) is displayed.
- [ ] Ordinary Class/Sub Risk values (e.g. `3`, `6.1`, `1.4`) display as-is.
- [ ] `UNSPECIFIED_PRIMARY_HAZARD` / `UNSPECIFIED_SUBSIDIARY_HAZARD` are never
      shown verbatim — they present as "확인 필요 / Review required".
- [ ] SG/SGG codes are never displayed anywhere in the UI.
- [ ] `REVIEW_REQUIRED` pairs remain clearly visible and distinct from CLEAR.
- [ ] A pair with `additionalRequirements` shows the generic review notice,
      not the raw requirement code.
- [ ] The adaptive test banner appears at the bottom without covering inputs,
      the Check Segregation button, result cards, or the keyboard.
- [ ] The keyboard remains usable with the banner present.
- [ ] Android bottom safe area (gesture nav bar) is respected whether or not
      an ad is showing.
- [ ] The segregation check still works if the ad fails to load or there is
      no network for ads.
- [ ] "Privacy choices" appears only when UMP reports it's required, and
      opens the privacy-options form.
- [ ] "Privacy Policy" footer link opens the configured URL (when set).

No broader device matrix is required for this MVP.

## Preview build

Build from this branch with:

```bash
cd mobile
eas build --platform android --profile preview
```

This profile always uses Google test ads (regardless of what's configured in
the `preview` EAS environment) and the production DG API.

**Last successful preview build:**

- EAS build ID: `97826bca-99ca-4b06-b726-288b9b7e76ab`
- Commit: `e71608d9e6f7ebed6b9af38936b5cf90edb73097`
- APK: <https://expo.dev/artifacts/eas/nsm2TX1g-gxLuB_7ugPdQIyRztkNWVKRzAJ53JY9sOU.apk>
- App version: `1.0.0`, versionCode: `1`
- Physical-device QA against this APK is still outstanding — see the
  checklist above.

## Production build

Not run as part of this PR. After merge, and only once the AdMob console
gates, Play Console gates, and the data-rights gate above are all satisfied:

```bash
cd mobile
eas build --platform android --profile production
```

`versionCode` stays `1` unless a real Google Play upload has already
consumed it — do not bump it just because a preview APK used `1`.
