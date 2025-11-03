import { initHost, handleHostMessage } from './host.js';
import { initPlayer, handlePlayerMessage } from './player.js';
import { initWorld } from './world.js';

const statusEl = document.getElementById('status');
const roleEl = document.getElementById('role');
const hostViewEl = document.getElementById('host-view');
const playerViewEl = document.getElementById('player-view');
const dataDisplayEl = document.getElementById('data-display');
const uiContainerEl = document.getElementById('ui-container');
const chatMessagesEl = document.getElementById('chat-messages');
const chatFormEl = document.getElementById('chat-form');
const chatInputEl = document.getElementById('chat-input');

function displayChatMessage(username, message, isValidated) {
    const messageEl = document.createElement('div');
    messageEl.classList.add('message');

    const usernameEl = document.createElement('span');
    usernameEl.classList.add('username');
    usernameEl.textContent = `${username}: `;
    
    const messageContentEl = document.createElement('span');
    messageContentEl.textContent = message;

    messageEl.appendChild(usernameEl);
    messageEl.appendChild(messageContentEl);
    
    if (isValidated) {
        const checkmarkEl = document.createElement('span');
        checkmarkEl.classList.add('checkmark');
        checkmarkEl.textContent = ' ✓';
        messageEl.appendChild(checkmarkEl);
    }

    // Prepend to show new messages at the top, which becomes the bottom due to flex-direction: column-reverse
    chatMessagesEl.prepend(messageEl);

    // Keep scroll at bottom (visually)
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}


async function main() {
    initWorld(document.getElementById('bg'));

    try {
        const room = new WebsimSocket();
        await room.initialize();
        statusEl.textContent = 'Connected to Retroverse.';

        const [creator, currentUser] = await Promise.all([
            window.websim.getCreatedBy(),
            window.websim.getCurrentUser()
        ]);

        const isHost = creator.username === currentUser.username;

        // Central message handler
        room.onmessage = (event) => {
            const { data, username } = event;
            switch(data.type) {
                case 'validated_chat_message':
                    if (data.payload) {
                        // The new payload contains senderName and message
                        displayChatMessage(data.payload.senderName, data.payload.message, true);
                    }
                    break;
                default:
                    // Route other messages to role-specific handlers
                    if (isHost) {
                        handleHostMessage(event, room);
                    } else {
                        handlePlayerMessage(event, currentUser.id);
                    }
                    break;
            }
        };

        // Chat form submission
        chatFormEl.addEventListener('submit', (e) => {
            e.preventDefault();
            const message = chatInputEl.value.trim();
            if (message) {
                room.send({
                    type: 'client_chat_message',
                    message: message,
                    userId: currentUser.id,
                    username: currentUser.username // Add username directly to the payload
                });
                chatInputEl.value = '';
            }
        });

        if (isHost) {
            roleEl.textContent = `Role: HOST (${currentUser.username})`;
            uiContainerEl.style.display = 'block'; // Show for host
            hostViewEl.style.display = 'block';
            playerViewEl.style.display = 'none'; // Hide player view for host
            initHost(room, dataDisplayEl);
        } else {
            roleEl.textContent = `Role: PLAYER (${currentUser.username})`;
            hostViewEl.style.display = 'none'; // Hide host view for player
            playerViewEl.style.display = 'block';
            uiContainerEl.style.display = 'block'; // Also show UI for players
            initPlayer(room, creator.username);
        }

        window.addEventListener('keydown', (event) => {
            if (event.key === '`' || event.key === '~') {
                if (uiContainerEl.style.display === 'block') {
                    uiContainerEl.style.display = 'none';
                } else {
                    uiContainerEl.style.display = 'block';
                }
            }
        });

    } catch (error) {
        console.error("Initialization failed:", error);
        statusEl.textContent = 'Error connecting to Retroverse.';
    }
}

main();