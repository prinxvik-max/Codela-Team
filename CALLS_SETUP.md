# Live call deployment

## Firestore rules

`firebase.json` now points to `firestore.rules`. The rules cover the app's private user records, public profile directory, friendships, private conversations, groups, and WebRTC signaling. Review them against the active Firebase project before deploying because deploying replaces that project's current Firestore rules.

After review, deploy with:

```sh
firebase deploy --only firestore:rules --project tapchat-d77e7
```

The Firebase CLI must be authenticated to the intended project. The rules file does not configure Cloudinary Storage or Firebase Storage.

## Network relay (TURN)

Calls use a public STUN server by default, which is enough on many networks. TURN relays media when a direct peer-to-peer connection is blocked; it requires a TURN provider or a separately hosted relay server.

To supply short-lived TURN settings, define `window.TAPCHAT_ICE_CONFIG_URL` before starting a call. The HTTPS endpoint must authenticate the Firebase ID token sent as a Bearer token and return:

```json
{
  "iceServers": [
    {
      "urls": ["turns:turn.example.com:5349"],
      "username": "short-lived-username",
      "credential": "short-lived-credential"
    }
  ]
}
```

Do not put a TURN provider's permanent secret in client-side JavaScript or commit it to the repository. Without a configured TURN endpoint, calls can still work where STUN can establish a direct connection, but restrictive networks may fail.

Calls require an HTTPS origin and camera/microphone permission. Group calls are limited to six participants because the app uses peer-to-peer connections rather than a media server.
