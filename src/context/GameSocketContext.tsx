import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type {
  BlackjackActionType,
  BlackjackTableView,
  ChatMessageItem,
  GameRoomSummary,
  PokerActionType,
  PokerTableView,
  TournamentSummary,
} from '../shared/types.ts';
import { apiFetch, makeIdempotencyKey, websocketUrl } from '../lib/api.ts';
import { useAuth } from './AuthContext.tsx';

interface GameSocketContextValue {
  wsConnected: boolean;
  reconnecting: boolean;
  currentRoom: GameRoomSummary | null;
  pokerState: PokerTableView | null;
  blackjackState: BlackjackTableView | null;
  currentTournament: TournamentSummary | null;
  roomChat: ChatMessageItem[];
  lobbyRooms: GameRoomSummary[];
  lobbyTournaments: TournamentSummary[];
  actionError: string | null;
  clearActionError: () => void;
  subscribeRoom: (roomId: string | null) => void;
  subscribeTournament: (tournamentId: string | null) => void;
  sendPokerAction: (action: PokerActionType, amount?: number) => Promise<void>;
  sendBlackjackAction: (action: BlackjackActionType, amount?: number) => Promise<void>;
  loadRoomSnapshot: (roomId: string) => Promise<void>;
  loadTournamentSnapshot: (tournamentId: string) => Promise<void>;
  refreshLobby: () => Promise<void>;
}

const GameSocketContext = createContext<GameSocketContextValue | null>(null);

export const GameSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token, refreshWallet, refreshSession } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const activeRoomIdRef = useRef<string | null>(null);
  const activeTournIdRef = useRef<string | null>(null);

  const [wsConnected, setWsConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<GameRoomSummary | null>(null);
  const [pokerState, setPokerState] = useState<PokerTableView | null>(null);
  const [blackjackState, setBlackjackState] = useState<BlackjackTableView | null>(null);
  const [currentTournament, setCurrentTournament] = useState<TournamentSummary | null>(null);
  const [roomChat, setRoomChat] = useState<ChatMessageItem[]>([]);
  const [lobbyRooms, setLobbyRooms] = useState<GameRoomSummary[]>([]);
  const [lobbyTournaments, setLobbyTournaments] = useState<TournamentSummary[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshLobby = useCallback(async () => {
    if (!token) return;
    try {
      const [rData, tData] = await Promise.all([
        apiFetch<{ rooms: GameRoomSummary[] }>('/api/rooms'),
        apiFetch<{ tournaments: TournamentSummary[] }>('/api/tournaments'),
      ]);
      setLobbyRooms(rData.rooms || []);
      setLobbyTournaments(tData.tournaments || []);
    } catch {
      // ignore transient error
    }
  }, [token]);

  const loadRoomSnapshot = useCallback(async (roomId: string) => {
    const data = await apiFetch<{
      room: GameRoomSummary;
      poker: PokerTableView | null;
      blackjack: BlackjackTableView | null;
      chat: ChatMessageItem[];
    }>(`/api/rooms/${roomId}`);
    setCurrentRoom(data.room);
    setPokerState(data.poker);
    setBlackjackState(data.blackjack);
    setRoomChat(data.chat || []);
  }, []);

  const loadTournamentSnapshot = useCallback(async (tournamentId: string) => {
    const data = await apiFetch<{ tournament: TournamentSummary }>(`/api/tournaments/${tournamentId}`);
    setCurrentTournament(data.tournament);
  }, []);

  useEffect(() => {
    if (!token) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
      return;
    }

    let closedIntentionally = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let attempt = 0;

    const connect = () => {
      if (closedIntentionally) return;
      const ws = new WebSocket(websocketUrl(token));
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setWsConnected(true);
        setReconnecting(false);
        if (activeRoomIdRef.current) {
          ws.send(JSON.stringify({ type: 'room:subscribe', roomId: activeRoomIdRef.current }));
        }
        if (activeTournIdRef.current) {
          ws.send(JSON.stringify({ type: 'tournament:subscribe', tournamentId: activeTournIdRef.current }));
        }
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 20_000);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'room:state') {
            setCurrentRoom(msg.room);
            if (msg.poker) setPokerState(msg.poker);
            if (msg.blackjack) setBlackjackState(msg.blackjack);
          } else if (msg.type === 'chat:message' && msg.message) {
            setRoomChat((prev) => {
              if (prev.some((m) => m.id === msg.message.id)) return prev;
              return [...prev.slice(-80), msg.message];
            });
          } else if (msg.type === 'tournament:state' && msg.tournament) {
            setCurrentTournament(msg.tournament);
          } else if (msg.type === 'lobby:update') {
            if (msg.rooms) setLobbyRooms(msg.rooms);
            if (msg.tournaments) setLobbyTournaments(msg.tournaments);
          } else if (msg.type === 'wallet:refresh') {
            void refreshWallet();
          } else if (msg.type === 'notifications:refresh') {
            void refreshSession();
          } else if (msg.type === 'action:error' && msg.error) {
            setActionError(msg.error);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (pingTimer) clearInterval(pingTimer);
        if (!closedIntentionally) {
          setReconnecting(true);
          const delay = Math.min(8000, 800 * Math.pow(1.5, attempt));
          attempt += 1;
          reconnectTimer = setTimeout(connect, delay);
        }
      };
    };

    connect();
    void refreshLobby();

    return () => {
      closedIntentionally = true;
      if (pingTimer) clearInterval(pingTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token, refreshLobby, refreshWallet, refreshSession]);

  const subscribeRoom = useCallback((roomId: string | null) => {
    activeRoomIdRef.current = roomId;
    if (!roomId) {
      setCurrentRoom(null);
      setPokerState(null);
      setBlackjackState(null);
      setRoomChat([]);
    } else {
      void loadRoomSnapshot(roomId);
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'room:subscribe', roomId }));
    }
  }, [loadRoomSnapshot]);

  const subscribeTournament = useCallback((tournamentId: string | null) => {
    activeTournIdRef.current = tournamentId;
    if (!tournamentId) {
      setCurrentTournament(null);
    } else {
      void loadTournamentSnapshot(tournamentId);
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'tournament:subscribe', tournamentId }));
    }
  }, [loadTournamentSnapshot]);

  const sendPokerAction = useCallback(async (action: PokerActionType, amount?: number) => {
    const roomId = activeRoomIdRef.current;
    if (!roomId) return;
    const actionId = makeIdempotencyKey('pk');
    setActionError(null);
    try {
      await apiFetch(`/api/rooms/${roomId}/poker/action`, {
        method: 'POST',
        body: JSON.stringify({ action, amount, actionId }),
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    }
  }, []);

  const sendBlackjackAction = useCallback(async (action: BlackjackActionType, amount?: number) => {
    const roomId = activeRoomIdRef.current;
    if (!roomId) return;
    const actionId = makeIdempotencyKey('bj');
    setActionError(null);
    try {
      await apiFetch(`/api/rooms/${roomId}/blackjack/action`, {
        method: 'POST',
        body: JSON.stringify({ action, amount, actionId }),
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    }
  }, []);

  return (
    <GameSocketContext.Provider
      value={{
        wsConnected,
        reconnecting,
        currentRoom,
        pokerState,
        blackjackState,
        currentTournament,
        roomChat,
        lobbyRooms,
        lobbyTournaments,
        actionError,
        clearActionError: () => setActionError(null),
        subscribeRoom,
        subscribeTournament,
        sendPokerAction,
        sendBlackjackAction,
        loadRoomSnapshot,
        loadTournamentSnapshot,
        refreshLobby,
      }}
    >
      {children}
    </GameSocketContext.Provider>
  );
};

export function useGameSocket() {
  const ctx = useContext(GameSocketContext);
  if (!ctx) throw new Error('useGameSocket must be used inside GameSocketProvider');
  return ctx;
}
