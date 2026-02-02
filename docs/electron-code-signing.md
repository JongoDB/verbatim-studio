# Electron Code Signing Setup

This document explains how to set up code signing for Verbatim Studio's Electron builds.

## Overview

Code signing is required for:
- **macOS**: Apps must be signed and notarized to run without Gatekeeper warnings
- **Windows**: Signed apps show publisher name instead of "Unknown Publisher"

## macOS Code Signing

### Prerequisites

1. Apple Developer account ($99/year)
2. Developer ID Application certificate

### Generate Certificate

1. Open Keychain Access on your Mac
2. Go to Keychain Access → Certificate Assistant → Request a Certificate from a Certificate Authority
3. Enter your email, select "Saved to disk"
4. Log in to [Apple Developer Portal](https://developer.apple.com)
5. Go to Certificates, Identifiers & Profiles → Certificates
6. Create a new certificate: "Developer ID Application"
7. Upload the certificate signing request
8. Download and double-click to install the certificate

### Export for CI

1. Open Keychain Access
2. Find your "Developer ID Application" certificate
3. Right-click → Export
4. Save as .p12 file with a strong password
5. Base64 encode the certificate:
   ```bash
   base64 -i certificate.p12 | tr -d '\n' | pbcopy
   ```
6. Add to GitHub Secrets:
   - `MAC_CERTS`: Paste the base64-encoded content
   - `MAC_CERTS_PASSWORD`: The password you set

### Notarization (Required for macOS 10.15+)

Apple requires apps to be notarized for users to run them without manual override.

1. Generate an app-specific password at [appleid.apple.com](https://appleid.apple.com)
2. Find your Team ID at [developer.apple.com/account](https://developer.apple.com/account)
3. Add to GitHub Secrets:
   - `APPLE_ID`: Your Apple ID email
   - `APPLE_APP_SPECIFIC_PASSWORD`: The app-specific password
   - `APPLE_TEAM_ID`: Your team ID (e.g., "ABC123XYZ")

## Windows Code Signing

### Prerequisites

1. EV (Extended Validation) Code Signing Certificate
2. Certificate must be from a trusted CA (DigiCert, Sectigo, etc.)

### Options

**Option A: Hardware Token (Traditional)**
- Certificate stored on USB hardware token
- Requires physical access during signing
- Not suitable for CI/CD

**Option B: Cloud Signing (Recommended for CI)**
- Use a cloud signing service:
  - [Azure SignTool](https://github.com/vcsjones/AzureSignTool)
  - [DigiCert KeyLocker](https://www.digicert.com/signing/keylocker)
  - [SSL.com eSigner](https://www.ssl.com/esigner/)

### For CI (Azure SignTool Example)

1. Upload your certificate to Azure Key Vault
2. Create a service principal with access
3. Add to GitHub Secrets:
   - `AZURE_KEY_VAULT_URI`: Your Key Vault URI
   - `AZURE_CLIENT_ID`: Service principal client ID
   - `AZURE_CLIENT_SECRET`: Service principal secret
   - `AZURE_TENANT_ID`: Azure tenant ID
   - `AZURE_CERT_NAME`: Certificate name in Key Vault

## GitHub Secrets Summary

| Secret | Platform | Description |
|--------|----------|-------------|
| `MAC_CERTS` | macOS | Base64-encoded .p12 certificate |
| `MAC_CERTS_PASSWORD` | macOS | Certificate password |
| `APPLE_ID` | macOS | Apple ID for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS | App-specific password |
| `APPLE_TEAM_ID` | macOS | Apple Developer Team ID |
| `WIN_CSC_LINK` | Windows | Certificate file path or URL |
| `WIN_CSC_KEY_PASSWORD` | Windows | Certificate password |

## Workflow Integration

The GitHub Actions workflow automatically uses these secrets when present:

```yaml
- name: Package Electron app
  run: pnpm --filter @verbatim/electron dist
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    # macOS
    CSC_LINK: ${{ secrets.MAC_CERTS }}
    CSC_KEY_PASSWORD: ${{ secrets.MAC_CERTS_PASSWORD }}
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
    # Windows
    WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
    WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
```

## Testing Without Signing

During development and testing, builds will work without code signing:
- **macOS**: Users can right-click → Open to bypass Gatekeeper
- **Windows**: Users will see "Unknown Publisher" warning

Add secrets when ready for production releases.

## Troubleshooting

### macOS: "The signature is invalid"
- Ensure certificate is not expired
- Check that the full certificate chain is included in the .p12

### macOS: Notarization failed
- Check APPLE_ID and password are correct
- Ensure app-specific password (not account password) is used
- Verify Team ID is correct

### Windows: Signing failed
- Verify certificate is valid and not expired
- Check that password is correct
- For cloud signing, verify service principal permissions
