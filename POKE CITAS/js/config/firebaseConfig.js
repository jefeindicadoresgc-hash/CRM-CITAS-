// ==========================================
// MÓDULO: CONEXIÓN A LA NUBE (FIRESTORE)
// ==========================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, collection, getDocs, addDoc, updateDoc, deleteDoc, doc, writeBatch } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC1DVA61DPFlbGSWr45GYqeAGg89-k5a4g",
  authDomain: "citas-hyundai-coatza.firebaseapp.com",
  projectId: "citas-hyundai-coatza",
  storageBucket: "citas-hyundai-coatza.firebasestorage.app",
  messagingSenderId: "333064695297",
  appId: "1:333064695297:web:da997c42555b2cb7bc1a00"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, writeBatch };