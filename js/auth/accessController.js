// =====================================================================
// ARCHIVO: /js/auth/accessController.js
// OBJETIVO: Login Filosófico Editorial, Puerta de Salida y Backdoor Admin
// =====================================================================

export let adminMode = false;
export let captchaPassed = false;

const FRASES_FILOSOFICAS = [
    {
        autor: "Marco Aurelio",
        antes: "La felicidad de tu vida depende de la calidad de tus ",
        despues: ".",
        correcta: "pensamientos",
        opciones: ["pensamientos", "posesiones", "palabras"]
    },
    {
        autor: "Séneca",
        antes: "No es que tengamos poco tiempo, sino que ",
        despues: " mucho.",
        correcta: "perdemos",
        opciones: ["perdemos", "esperamos", "buscamos"]
    },
    {
        autor: "Aristóteles",
        antes: "Somos lo que hacemos repetidamente. La excelencia no es un acto, sino un ",
        despues: ".",
        correcta: "hábito",
        opciones: ["hábito", "destino", "talento"]
    },
    {
        autor: "Epicteto",
        antes: "No nos afecta lo que nos sucede, sino lo que nos decimos sobre lo que nos ",
        despues: ".",
        correcta: "sucede",
        opciones: ["sucede", "falta", "espera"]
    },
    {
        autor: "Sócrates",
        antes: "Una vida sin ",
        despues: " no merece ser vivida.",
        correcta: "examen",
        opciones: ["examen", "fortuna", "riesgo"]
    },
    {
        autor: "Heráclito",
        antes: "Lo único constante en la vida es el ",
        despues: ".",
        correcta: "cambio",
        opciones: ["cambio", "silencio", "tiempo"]
    },
    {
        autor: "Confucio",
        antes: "No importa lo lento que vayas mientras no te ",
        despues: ".",
        correcta: "detengas",
        opciones: ["detengas", "rindas", "apresures"]
    }
];

export function initAuth(syncCallback, renderCallback) {
    checkDailyLogin(syncCallback);

    const passInput = document.getElementById('password');
    if (passInput) {
        passInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') attemptLogin(syncCallback);
        });
    }

    const btnLoginSubmit = document.getElementById('btn-login-submit');
    if (btnLoginSubmit) {
        btnLoginSubmit.addEventListener('click', () => attemptLogin(syncCallback));
    }

    // Botón Puerta Animada (Cerrar Sesión)
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            btnLogout.classList.add('door-opening');
            setTimeout(() => {
                localStorage.removeItem('crmLoginDate');
                localStorage.removeItem('pokeLoginDate');
                location.reload();
            }, 480);
        });
    }

    // BACKDOOR: MODO ADMINISTRADOR (0520) — Solo activo una vez dentro del CRM
    let keysPressed = "";
    document.addEventListener('keydown', (e) => {
        const loginScreen = document.getElementById('login-screen');
        if (loginScreen && !loginScreen.classList.contains('hidden')) return;
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

        keysPressed += e.key;
        if (keysPressed.length > 4) keysPressed = keysPressed.slice(-4);
        if (keysPressed === "0520") {
            adminMode = !adminMode;
            alert(adminMode ? "🔓 MODO ADMINISTRADOR ACTIVADO" : "🔒 Modo Administrador Desactivado");
            renderCallback();
        }
    });
}

function checkDailyLogin(syncCallback) {
    const today = new Date().toLocaleDateString();
    if (localStorage.getItem('crmLoginDate') === today || localStorage.getItem('pokeLoginDate') === today) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('main-screen').classList.remove('hidden');
        syncCallback();
    } else {
        loadPhilosophyCaptcha();
    }
}

function loadPhilosophyCaptcha() {
    captchaPassed = false;
    const quoteEl = document.getElementById('philo-quote');
    const authorEl = document.getElementById('philo-author');
    const optionsEl = document.getElementById('philo-options');
    const feedbackEl = document.getElementById('philo-feedback');
    const passSection = document.getElementById('password-section');
    if (!quoteEl || !optionsEl) return;

    passSection.classList.add('hidden');
    if (feedbackEl) feedbackEl.textContent = "";

    const item = FRASES_FILOSOFICAS[Math.floor(Math.random() * FRASES_FILOSOFICAS.length)];
    quoteEl.innerHTML = `“${item.antes}<span id="philo-blank" class="philo-blank">_______</span>${item.despues}”`;
    authorEl.textContent = `— ${item.autor}`;

    const shuffled = [...item.opciones].sort(() => Math.random() - 0.5);
    optionsEl.innerHTML = "";

    shuffled.forEach(word => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'philo-word-btn';
        btn.textContent = word;
        btn.onclick = () => {
            if (word === item.correcta) {
                captchaPassed = true;
                const blank = document.getElementById('philo-blank');
                if (blank) {
                    blank.textContent = word;
                    blank.classList.add('solved');
                }
                optionsEl.innerHTML = "";
                if (feedbackEl) {
                    feedbackEl.textContent = "Reflexión completada.";
                    feedbackEl.style.color = "#547a53";
                }
                passSection.classList.remove('hidden');
                const passInput = document.getElementById('password');
                if (passInput) passInput.focus();
            } else {
                btn.classList.add('wrong');
                if (feedbackEl) {
                    feedbackEl.textContent = "Intenta con otra palabra.";
                    feedbackEl.style.color = "#722227";
                }
                setTimeout(() => btn.classList.remove('wrong'), 450);
            }
        };
        optionsEl.appendChild(btn);
    });
}

function attemptLogin(syncCallback) {
    if (!captchaPassed) return alert("Completa la frase primero.");
    const passInput = document.getElementById('password');
    if (passInput.value.trim() === "2099") {
        localStorage.setItem('crmLoginDate', new Date().toLocaleDateString());
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('main-screen').classList.remove('hidden');
        syncCallback();
    } else {
        alert("Clave incorrecta.");
        passInput.value = "";
        passInput.focus();
    }
}