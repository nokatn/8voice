# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.2.x | ✅ |

## Reporting a Vulnerability

If you discover a security vulnerability in 8voice, please report it responsibly.

**Please do not open a public issue for security vulnerabilities.**

Instead, contact the maintainers directly by opening a private security advisory on GitHub, or send an email with details to the repository owner.

Include the following information:

- A clear description of the vulnerability
- Steps to reproduce
- Affected versions
- Possible impact
- Suggested fix or mitigation (if any)

We aim to respond to security reports within 7 days and will keep you informed throughout the resolution process.

## Security Notes

- API keys (Groq, Deepgram, AssemblyAI) are stored locally in the user's settings file and are never sent anywhere except to the configured provider.
- Transcription audio is processed locally before being sent to a cloud provider only when cloud mode is explicitly enabled.
- The app requests only the platform permissions required for audio capture, global shortcuts, and text injection.
- Updater bundles are signed with an Ed25519 key to verify authenticity before installation.
