// =====================================================================
// ARCHIVO: /js/auth/accessController.js
// OBJETIVO: Gestión de Login (Pokédex) y Modo Administrador (Backdoor)
// =====================================================================

export let adminMode = false;
export let captchaPassed = false;

// 1. INICIALIZACIÓN DEL LOGIN
export function initAuth(syncCallback, renderCallback) {
    checkDailyLogin(syncCallback);
    
    const btnPowerOn = document.getElementById('btn-power-on');
    if (btnPowerOn) {
        btnPowerOn.addEventListener('click', () => {
            document.getElementById('power-on-screen').classList.add('hidden'); 
            document.getElementById('game-screen').classList.remove('hidden');
            loadCaptcha();
        });
    }

    const passInput = document.getElementById('password');
    if (passInput) {
        passInput.addEventListener('keypress', (e) => { 
            if (e.key === 'Enter') attemptLogin(syncCallback); 
        });
    }

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => { 
            localStorage.removeItem('pokeLoginDate'); 
            location.reload(); 
        });
    }

    // 2. BACKDOOR: MODO ADMINISTRADOR (0520) - APARICIÓN INSTANTÁNEA
    let keysPressed = "";
    document.addEventListener('keydown', (e) => {
        keysPressed += e.key;
        if (keysPressed.length > 4) keysPressed = keysPressed.slice(-4);
        if (keysPressed === "0520") {
            adminMode = !adminMode;
            
            // Forzar la aparición instantánea del panel en la pantalla
            const uploadPanel = document.getElementById('upload-panel');
            const activeTabBtn = document.querySelector('.tab-btn.active');
            let currentTab = activeTabBtn ? activeTabBtn.getAttribute('data-target') : '';
            
            if (uploadPanel && currentTab === 'activos') {
                if (adminMode) uploadPanel.classList.remove('hidden');
                else uploadPanel.classList.add('hidden');
            }
            
            alert(adminMode ? "🔓 MODO ADMINISTRADOR ACTIVADO" : "🔒 Modo Administrador Desactivado");
            renderCallback(); 
        }
    });
}

function createPokeballRain() {
    const balls = ['https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png', 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/great-ball.png', 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/ultra-ball.png'];
    for (let i = 0; i < 25; i++) {
        let ball = document.createElement('div');
        ball.className = 'falling-ball';
        ball.style.backgroundImage = `url('${balls[Math.floor(Math.random() * balls.length)]}')`;
        ball.style.left = `${Math.random() * 100}vw`;
        ball.style.width = `${Math.random() * 50 + 60}px`; ball.style.height = ball.style.width;
        ball.style.animationDuration = `${Math.random() * 3 + 4}s`; ball.style.animationDelay = `${Math.random() * 5}s`;
        document.getElementById('rain-container').appendChild(ball);
    }
}

function checkDailyLogin(syncCallback) {
    createPokeballRain();
    if (localStorage.getItem('pokeLoginDate') === new Date().toLocaleDateString()) {
        document.getElementById('login-screen').classList.add('hidden'); 
        document.getElementById('main-screen').classList.remove('hidden'); 
        syncCallback(); 
    }
}

async function loadCaptcha() {
    captchaPassed = false; 
    document.getElementById('captcha-img').className = 'silhouette'; 
    document.getElementById('password-section').classList.add('hidden'); 
    document.getElementById('captcha-buttons').innerHTML = "Cargando...";
    try {
        const randomIds = Array.from({length: 3}, () => Math.floor(Math.random() * 151) + 1);
        const pokemons = await Promise.all(randomIds.map(id => fetch(`https://pokeapi.co/api/v2/pokemon/${id}`).then(res => res.json())));
        const correctIndex = Math.floor(Math.random() * 3);
        document.getElementById('captcha-img').src = pokemons[correctIndex].sprites.front_default;
        document.getElementById('captcha-hint').textContent = `Pista: Es ${pokemons[correctIndex].name.toUpperCase()}`;
        document.getElementById('captcha-buttons').innerHTML = "";
        pokemons.forEach((poke, index) => {
            const btn = document.createElement('button'); btn.className = 'btn-captcha'; btn.textContent = poke.name;
            btn.onclick = () => {
                if(index === correctIndex) {
                    captchaPassed = true; 
                    document.getElementById('captcha-img').classList.add('revealed'); 
                    document.getElementById('captcha-hint').style.color = "green"; 
                    document.getElementById('captcha-buttons').innerHTML = ""; 
                    document.getElementById('password-section').classList.remove('hidden');
                } else alert("¡Ese no es!");
            }; 
            document.getElementById('captcha-buttons').appendChild(btn);
        });
    } catch (e) {
        console.error("Error cargando Pokémon:", e);
    }
}

function attemptLogin(syncCallback) {
    if (!captchaPassed) return alert("Adivina el Pokémon primero.");
    if (document.getElementById('password').value.trim() === "2099") {
        localStorage.setItem('pokeLoginDate', new Date().toLocaleDateString()); 
        document.getElementById('login-screen').classList.add('hidden'); 
        document.getElementById('main-screen').classList.remove('hidden'); 
        syncCallback();
    } else { 
        alert("Contraseña incorrecta."); 
        document.getElementById('password').value = ""; 
    }
}