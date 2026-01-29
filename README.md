
# Utsho AI - Deployment Guide

## 1. Firebase Setup (Cloud Database)
1. Go to [Firebase Console](https://console.firebase.com/).
2. Select your project: **Utsho-AI**.
3. In the **Firestore Database** section, go to the **Rules** tab.
4. Replace the existing rules with these (CRITICAL):
   ```firestore
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       
       // Rules for the 'users' collection
       match /users/{userEmail}/{document=**} {
         // Users can only read/write their own documents
         allow read, write: if request.auth != null && request.auth.token.email.lower() == userEmail.lower();
       }
       
       // Rules for the 'system' collection (Admin Only)
       match /system/{document=**} {
         // Only Shakkhor can read the health reports
         allow read: if request.auth != null && request.auth.token.email == 'shakkhorpaul50@gmail.com';
         // Any logged in user can report a failure (write/update)
         allow create, update: if request.auth != null;
       }
     }
   }
   ```
5. Click **Publish**.

## 2. Environment Variables
Ensure these are set in your Cloudflare dashboard:
- `API_KEY`: Your Gemini API key.
- `FIREBASE_API_KEY`: ...
- `FIREBASE_PROJECT_ID`: utsho-ai
- (And all other FIREBASE_ variables)
