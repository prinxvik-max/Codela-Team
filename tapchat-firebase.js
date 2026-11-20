import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCWa9XkYkmmEpsqFdmSWIhArKt2Cj_8TSY",
  authDomain: "tapchat-d77e7.firebaseapp.com",
  projectId: "tapchat-d77e7",
  storageBucket: "tapchat-d77e7.firebasestorage.app",
  messagingSenderId: "309292071078",
  appId: "1:309292071078:web:532d9cf0f8f7632f965c67",
  measurementId: "G-D752JEHRC8"
};

export const app = getApps().find(item => item.options.projectId === firebaseConfig.projectId)
  || initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
