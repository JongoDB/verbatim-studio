# Cloud Storage Setup

## Google Drive

| Step | Action |
|------|--------|
| 1 | [Create a Google Cloud Project](https://console.cloud.google.com/projectcreate) |
| 2 | [Enable the Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com) ← **Required** |
| 3 | [Configure OAuth Branding](https://console.cloud.google.com/auth/branding) → Get Started → External |
| 4 | [Add Scopes](https://console.cloud.google.com/auth/scopes) → Add `drive.file` |
| 5 | [Add Test User](https://console.cloud.google.com/auth/audience) → Add your email |
| 6 | [Create OAuth Credentials](https://console.cloud.google.com/apis/credentials) → OAuth client ID → Web application |
| 7 | Add all 4 redirect URIs, then copy Client ID & Secret |

### Redirect URIs

Add **all 4** to your OAuth app:

```
http://localhost:9876/callback
http://localhost:9877/callback
http://localhost:9878/callback
http://localhost:9879/callback
```

### Troubleshooting

| Error | Fix |
|-------|-----|
| `access_denied` | [Verify test user](https://console.cloud.google.com/auth/audience) is added |
| `API not enabled` | [Enable Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com) |
| `Invalid redirect URI` | Add all 4 URIs exactly as shown above |

### Manage Access

[Revoke Verbatim Studio access](https://myaccount.google.com/connections)

---

## Microsoft OneDrive

| Step | Action |
|------|--------|
| 1 | [Create App Registration](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) → New registration |
| 2 | Authentication → Add all 4 redirect URIs (Web platform) |
| 3 | Certificates & secrets → New client secret → Copy the **Value** |
| 4 | Overview → Copy **Application (client) ID** |

### Manage Access

[Revoke Verbatim Studio access](https://account.live.com/consent/Manage)

---

## Dropbox

| Step | Action |
|------|--------|
| 1 | [Create App](https://www.dropbox.com/developers/apps/create) → Scoped access → Full Dropbox |
| 2 | Settings → Add all 4 redirect URIs |
| 3 | Copy **App key** and **App secret** |

### Manage Access

[Revoke Verbatim Studio access](https://www.dropbox.com/account/connected_apps)
