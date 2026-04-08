# 🎮 Snap Puzzle

An interactive real-time gesture-controlled puzzle game built using **React + MediaPipe + Firebase**.

Users can:
- Select grid size using hand gestures
- Capture a live image using a pinch gesture
- Solve a sliding puzzle using hand tracking
- Submit scores to a real-time leaderboard

---

> 🚀 Play the game live: https://snap-puxxle.web.app/

## 🚀 Features

- ✋ Gesture-based UI (MediaPipe Hand Tracking)
- 📸 Live camera capture
- 🧩 Dynamic puzzle generation (3x3, 4x4, 5x5)
- 🏆 Real-time leaderboard (Firestore)
- 🔐 Anonymous authentication (Firebase Auth)
- ⚡ Smooth animations + interactions

---

## 🛠️ Tech Stack

- **Frontend:** React + Vite + TypeScript
- **AI / CV:** MediaPipe Tasks Vision
- **Backend:** Firebase (Firestore + Auth)
- **Hosting:** Firebase Hosting

---

## 📦 Setup Instructions

### 1. Clone the repo

```bash
git clone <your-repo-url>
cd live-puzzle
```

### 2. Install dependencies
```
npm install
```

### 3. Setup environment variables

Create a .env file using .env.example
```
cp .env.example .env
```
Fill in your Firebase config.

### 4. Run locally
```
npm run dev
```

### 5. Build
```
npm run build
```
### 6. Deploy
```
firebase deploy
```


## 🔥 Firebase Setup 
### 1. Create Project

Go to:
https://console.firebase.google.com

Click Add Project
Disable Analytics (optional)

### 2. Enable Authentication
Go to Authentication
Click Get Started
Enable:
✅ Anonymous Authentication

### 3. Enable Firestore
Go to Firestore Database
Click Create Database
Select:
✅ Start in Test Mode

### 4. Firestore Rules (for development)
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
### 5. Get Firebase Config

Go to:

Project Settings → General → Your Apps → Web App

Copy config into .env

📊 Database Structure
artifacts/
  {appId}/
    public/
      data/
        leaderboard/
          {docId}

Each entry:

{
  "name": "PLAYER",
  "time": 12345,
  "moves": 20,
  "grid": 3,
  "date": 1710000000000
}


## ⚠️ Notes
- Camera access is required
- Works best on Chrome / Edge
- Network issues may block MediaPipe model loading
- You can update `.firebaserc` with your own Firebase project ID if needed.