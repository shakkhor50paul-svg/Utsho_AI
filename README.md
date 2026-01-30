
# Utsho AI - Deployment Guide

## 1. Firebase Setup (Cloud Database)
1. Go to [Firebase Console](https://console.firebase.com/).
2. Select your project: **Utsho-AI**.
3. In the **Firestore Database** section, go to the **Rules** tab.
4. Replace the existing rules with these (ADMIN MASTER VERSION):
   ```firestore
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       
       // MASTER RULE: Admin Shakkhor can do anything
       match /{document=**} {
         allow read, write: if request.auth != null && request.auth.token.email == 'shakkhorpaul50@gmail.com';
       }

       // NORMAL USER RULES: Privacy first
       match /users/{userEmail}/{document=**} {
         // Users can only read/write their own documents
         allow read, write: if request.auth != null && request.auth.token.email.lower() == userEmail.lower();
       }
       
       // SYSTEM REPORTING: Allow users to report API failures
       match /system/api_health/keys/{keyId} {
         allow create, update: if request.auth != null;
       }
     }
   }
   ```
5. Click **Publish**.

## 2. Environment Variables
Ensure these are set in your Cloudflare dashboard:
- `API_KEY`: Your Gemini API key pool (comma separated).
- `FIREBASE_API_KEY`: Your Firebase Web SDK Key.
- `FIREBASE_PROJECT_ID`: utsho-ai
- `FIREBASE_AUTH_DOMAIN`: utsho-ai.firebaseapp.com
- `FIREBASE_STORAGE_BUCKET`: utsho-ai.appspot.com
- `FIREBASE_MESSAGING_SENDER_ID`: ...
- `FIREBASE_APP_ID`: ...
