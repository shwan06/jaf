# Publishing Maze Rush Runner to Google Play

A practical checklist to take the signed App Bundle from this repo to a live
listing. Work top to bottom.

## 0. Prerequisites

- A **Google Play Console** account (one-time US$25 registration fee).
- A signed release bundle: `./gradlew bundleRelease` →
  `app/build/outputs/bundle/release/app-release.aab`
  (see *Signing & release* in the root [README](../README.md)).
- A **privacy policy URL** (host [PRIVACY_POLICY.md](PRIVACY_POLICY.md)
  somewhere public — GitHub Pages, a Gist, or any static host).

## 1. App signing

Use **Play App Signing** (recommended): you upload an AAB signed with your
*upload key* (the keystore from the README), and Google manages the final
app-signing key. Keep your upload keystore and passwords backed up — losing
them means you can't push updates.

- `applicationId`: `com.shwan.mazerunner` (set in `app/build.gradle.kts`).
  This is permanent once published — choose deliberately.
- Bump `versionCode` (integer, must increase every upload) and `versionName`
  (human string) in `app/build.gradle.kts` for each release.

## 2. Create the app in Play Console

1. **Create app** → name `Maze Rush Runner`, default language, type **Game**,
   Free or Paid.
2. Complete **Dashboard → "Set up your app"** tasks (below).

## 3. Store listing assets

| Asset | Spec |
|-------|------|
| App name | ≤ 30 chars — e.g. "Maze Rush Runner" |
| Short description | ≤ 80 chars hook |
| Full description | ≤ 4000 chars — features, controls, modes |
| App icon | 512×512 PNG (32-bit, with alpha) |
| Feature graphic | 1024×500 PNG/JPG |
| Phone screenshots | 2–8, 16:9 or 9:16, min 320px |
| (Optional) Tablet screenshots, promo video | — |

> The in-app launcher icon is an adaptive vector. For the **512×512 store
> icon** you'll need a raster export — render `ic_launcher_foreground` over
> `ic_launcher_background` at 512×512.

**Suggested copy**

- *Short:* "Swipe through endless mazes — grab coins, dodge chasers, beat the clock!"
- *Full:* lead with the core loop, then bullet the features (procedural mazes,
  smart chasers, score chase, offline play, tiny download).

## 4. Content & policy declarations

Complete every section under **App content**:

- **Privacy policy** — paste your hosted URL.
- **Ads** — declare whether the app contains ads (this build: **No**).
- **Content rating** — fill the IARC questionnaire (this game → "Everyone").
- **Target audience & content** — choose age groups.
- **Data safety** — declare data collection (this build collects **none**;
  if you add analytics/ads later, update this form).
- **Government apps / financial / health** — N/A.

## 5. Categorization

- Category: **Game → Arcade** (or Action).
- Tags: maze, runner, arcade, puzzle.
- Contact details: email (required), website/phone optional.

## 6. Release tracks (test before production)

1. **Internal testing** — fastest; up to 100 testers by email. Upload the AAB
   here first and smoke-test on real devices.
2. **Closed testing** — wider invite list / opt-in link. Google now expects
   meaningful closed testing before production for new personal accounts.
3. **Open testing** *(optional)* — public beta.
4. **Production** — full rollout (use staged % rollout to limit blast radius).

For each: **Create release → upload AAB → add release notes → review → roll out.**

## 7. Review & go live

After submitting production, review typically takes hours to a few days. Watch
**Policy status** and **Pre-launch report** (Play runs your build on real
devices and flags crashes/ANRs/accessibility issues).

## 8. Post-launch

- Monitor **Android vitals** (crash rate, ANR rate).
- Respond to reviews.
- Ship updates by bumping `versionCode`/`versionName` and uploading a new AAB.

---

### Quick command reference

```bash
# Build the release bundle (needs signing properties configured)
./gradlew bundleRelease

# Verify it installs & runs as a release on a device
./gradlew installRelease

# Inspect the bundle
bundletool build-apks --bundle=app-release.aab --output=app.apks
```
