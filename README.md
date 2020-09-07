# autoTabSync
Chrome extension for automatic tab synchronization

## Features
- Sync newly created windows and tabs
- Sync removed windows and tabs
- Sync takes at most several seconds
- Not in Chrome web store, so you have to set unique extension ID. You'll have to:
 1. Generate a key file for your extension. You can pack existing extension into a `.crx` file in `chrome://extensions`. If you don't provide a key file, Chrome generates a new one for you.
 2. The generate key file should look like:
 ```-----BEGIN PRIVATE KEY-----
 MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDPEnpjjzumHrUz
 ... more lines ...
 AlW3GpJiN8Y/DtHRCw93IPuy
 -----END PRIVATE KEY-----
 ```
 3. Copy the contents of the key file, without the first and the last lines (the two lines starting with '----'). Also, remove the newlines.
 4. Paste the one-lined PEM content into `manifest.json`, like shown below:
 ```
 {
     "key": "MIIE...more characters... Puy",
     "name": ... more lines ...
 }
 ```
 5. In `chrome://extensions`, click 'Load unpacked' then select the folder that contains this extension.

## TODO
- Sync faster, more close to real-time
- Support multiple sessions at a time
