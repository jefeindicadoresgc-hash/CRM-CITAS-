// =====================================================================
// ARCHIVO: /js/config/firebaseSecondary.js
// OBJETIVO: Conexión aislada a Realtime Database (Tablero Pruebas)
// =====================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseSecondaryConfig = {
    apiKey: "AIzaSyA-x8ZZvJXAOK7Q18PVWPybmfPZ7xDBNHo",
    authDomain: "tablero-pruebas.firebaseapp.com",
    databaseURL: "https://tablero-pruebas-default-rtdb.firebaseio.com",
    projectId: "tablero-pruebas",
    storageBucket: "tablero-pruebas.firebasestorage.app",
    messagingSenderId: "900913447132",
    appId: "1:900913447132:web:fd3b5cc73af4263d69b419"
};

// Inicializamos la app con un nombre ("secondaryApp") para que no choque con la principal
const secondaryApp = initializeApp(firebaseSecondaryConfig, "secondaryApp");
export const secondaryDb = getDatabase(secondaryApp);