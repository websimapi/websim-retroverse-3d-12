import { initializeDatabase, subscribeToGameState, updatePlayersData, updateWorldData } from './database.js';
import { getPlayer, setPlayerPosition, updatePeers } from './world.js';

const UPDATE_INTERVAL = 200; // 5 times per second
const DATABASE_UPDATE_INTERVAL = 500; // 2 times per second
const POSITION_TOLERANCE = 5; // Max distance before auto-correct

// A map to link a client's temporary connection ID to their persistent user ID.
const clientIdToUserId = new Map();
let playersData = {}; // Moved to module scope for access in handler

export function handleHostMessage(event, room) {
    const { data, clientId } = event; // Removed 'username' from destructuring, it's not on the event.
    const { type, position, userId } = data;
    
    switch (type) {
        case 'client_chat_message':
            if (data.message && data.userId) {
                // Prioritize getting username from room.peers as it's the most "live" source.
                const senderPeer = room.peers[clientId];
                const senderUsername = senderPeer ? senderPeer.username : 'Unknown';

                // Host validates the message and relays it in a structured object
                room.send({
                    type: 'validated_chat_message',
                    payload: {
                        senderId: data.userId,
                        senderName: senderUsername,
                        message: data.message,
                        timestamp: new Date().toISOString()
                    }
                });
            }
            break;

        case 'player_position_update':
            // Ignore position updates from self
            if (clientId === room.clientId) return;
            if (!userId) return;

            // Map clientId to userId when we first hear from them
            if (!clientIdToUserId.has(clientId)) {
                console.log(`Mapping new connection: clientId ${clientId} to userId ${userId}`);
                clientIdToUserId.set(clientId, userId);
            }

            // Validate position against stored position
            const storedData = playersData[userId];
            if (storedData && storedData.position) {
                const dx = position.x - storedData.position.x;
                const dy = position.y - storedData.position.y;
                const dz = position.z - storedData.position.z;
                const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

                if (distance > POSITION_TOLERANCE) {
                    console.log(`Position mismatch for ${room.peers[clientId]?.username}. Distance: ${distance}. Auto-correcting...`);
                    // Send correction back to client
                    room.send({
                        type: 'position_correction',
                        position: storedData.position
                    }, clientId);
                    return; // Don't update with the incorrect position
                }
            }

            playersData[userId] = {
                username: room.peers[clientId]?.username,
                position,
                timestamp: new Date().toISOString()
            };
            break;
    }
}

export async function initHost(room, dataDisplayEl) {
    console.log("Initializing Host...");
    const gameStateRecord = await initializeDatabase(room);
    if (!gameStateRecord) {
        dataDisplayEl.textContent = "Error: Could not initialize or find game state record.";
        return;
    }

    const recordId = gameStateRecord.id;
    playersData = gameStateRecord.slot_1 || {}; // Assign to module-scoped variable
    let lastSavedPlayersData = JSON.parse(JSON.stringify(playersData)); // Deep copy for comparison
    
    // Initialize world data if it doesn't exist
    if (!gameStateRecord.slot_0 || gameStateRecord.slot_0.seed === undefined) {
        await updateWorldData(room, recordId, { seed: 0 });
    }

    const currentUser = await window.websim.getCurrentUser();
    const hostUserId = currentUser.id;

    // Load host's own position if it exists
    if (playersData[hostUserId]) {
        const savedPosition = playersData[hostUserId].position;
        if (savedPosition) {
            console.log('Host loading saved position:', savedPosition);
            setPlayerPosition(savedPosition);
        }
    }

    subscribeToGameState(room, (state) => {
        if (state) {
            dataDisplayEl.textContent = JSON.stringify(state, null, 2);
            if(state.slot_1) {
                // Merge database state with in-memory state, giving precedence to in-memory for recent changes.
                playersData = { ...state.slot_1, ...playersData };
            }
        } else {
            dataDisplayEl.textContent = "Waiting for game state...";
        }
    });

    // Main real-time update loop for host (sends data to players)
    setInterval(() => {
        // 1. Update host's own data in memory
        const hostPlayer = getPlayer();
        if (hostPlayer) {
            playersData[hostUserId] = {
                username: currentUser.username,
                position: {
                    x: hostPlayer.position.x,
                    y: hostPlayer.position.y,
                    z: hostPlayer.position.z,
                },
                timestamp: new Date().toISOString()
            };
        }

        // 2. Build the list of players to render and broadcast.
        // We will show all players from the database (`playersData`),
        // and later filter what we broadcast to only those connected.
        const allKnownPlayers = { ...playersData };

        const connectedPlayersForBroadcast = {};
        const connectedClientIds = new Set(Object.keys(room.peers));
        
        // Ensure host is always included in broadcast
        if (playersData[hostUserId]) {
            connectedPlayersForBroadcast[hostUserId] = playersData[hostUserId];
        }

        // Add other connected peers to the broadcast list
        for (const clientId of connectedClientIds) {
            if (clientId === room.clientId) continue; // Skip self (host)
            const userId = clientIdToUserId.get(clientId);
            if (userId && playersData[userId]) {
                 connectedPlayersForBroadcast[userId] = playersData[userId];
            }
        }
        
        // 3. Broadcast the connected player state and update the host's local view
        // The broadcast only contains currently connected players.
        room.send({
            type: 'players_state_update',
            players: connectedPlayersForBroadcast
        });
        
        // The host's renderer gets the data for ALL known players.
        updatePeers(allKnownPlayers, hostUserId);

    }, UPDATE_INTERVAL);

    // Separate, less frequent loop for database persistence
    setInterval(() => {
        // Compare current data with the last saved state
        if (JSON.stringify(playersData) !== JSON.stringify(lastSavedPlayersData)) {
            console.log("Player data has changed, updating database...");
            updatePlayersData(room, recordId, playersData);
            lastSavedPlayersData = JSON.parse(JSON.stringify(playersData)); // Update last saved state
        }
    }, DATABASE_UPDATE_INTERVAL);

    // Handle disconnections to clean up the map
    room.subscribePresence((presence) => {
        const connectedClientIds = new Set(Object.keys(presence));
        for (const [clientId, userId] of clientIdToUserId.entries()) {
            if (!connectedClientIds.has(clientId)) {
                console.log(`Peer disconnected. Removing mapping for client ${clientId} (user ${userId})`);
                clientIdToUserId.delete(clientId);
            }
        }
    });
}