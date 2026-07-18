import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDftUpjVWSDQS7sQ2V295XJecFoP7tk7Qk",
  authDomain: "your-journey-your-tools.firebaseapp.com",
  projectId: "your-journey-your-tools",
  storageBucket: "your-journey-your-tools.firebasestorage.app",
  messagingSenderId: "547110387626",
  appId: "1:547110387626:web:25e3ade04ad02ed92935d3"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
