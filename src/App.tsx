/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, type ErrorInfo, type ReactNode, useEffect, useState } from 'react';
import {
  Coins,
  Home,
  Mail,
  Plus,
  Shield,
  Spade,
  Trophy,
  User,
  Users,
  Wifi,
} from 'lucide-react';
import { AuthViews, type AuthScreenMode } from './components/AuthViews.tsx';
import { FriendSpectatorView } from './components/FriendSpectatorView.tsx';
import { BlackjackTableView } from './components/BlackjackTableView.tsx';
import {
  type AppScreen,
  CreatePrivateRoomView,
  JoinPrivateRoomView,
  MainLobbyView,
  RoomBrowserView,
  RoomWaitingLobbyView,
} from './components/LobbyViews.tsx';
import { OfflineIndicator } from './components/OfflineIndicator.tsx';
import { PokerTableView } from './components/PokerTableView.tsx';
import { PWAInstallButton } from './components/PWAInstallButton.tsx';
import {
  AdminDashboardView,
  DailyBonusView,
  FriendsView,
  GameHistoryView,
  InboxView,
  LeaderboardsView,
  PlayerProfileView,
  SettingsView,
  WalletView,
} from './components/SocialAndAccountViews.tsx';
import {
  CreateTournamentView,
  TournamentBrowserView,
  TournamentDetailView,
} from './components/TournamentViews.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { GameSocketProvider, useGameSocket } from './context/GameSocketContext.tsx';
import { apiFetch } from './lib/api.ts';
import type { GameRoomSummary } from './shared/types.ts';
import { PlayerAvatar } from './utils/avatars.tsx';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message || 'Unexpected application error' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Midnight Poker Club UI ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[100dvh] bg-[#060911] text-slate-100 flex items-center justify-center p-6">
          <div className="glass-bubbly max-w-md w-full rounded-[32px] border border-rose-500/40 p-6 text-center space-y-4">
            <h1 className="text-xl font-display font-bold text-white">Table Display Interrupted</h1>
            <p className="text-xs text-slate-400">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="btn-glossy btn-glossy-blue px-5 py-2.5 rounded-full text-white font-display font-bold text-xs"
            >
              Reconnect to Midnight Poker Club
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function getInitialAuthMode(): AuthScreenMode {
  if (typeof window !== 'undefined') {
    if (window.location.hash.includes('type=recovery')) {
      return 'new_password';
    }
    if (window.location.hash.includes('reset-password')) {
      return 'reset';
    }
  }
  return 'welcome';
}

const ClubShell: React.FC = () => {
  const { loading, user, wallet, activeRoom, passwordRecoveryActive, refreshWallet, refreshSession } = useAuth();
  const { reconnecting } = useGameSocket();

  const [screen, setScreen] = useState<AppScreen>('lobby');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [spectating, setSpectating] = useState<{roomId: string; friendId: string; username: string} | null>(null);
  const [activeTournamentId, setActiveTournamentId] = useState<string | null>(null);
  const [tournamentTab, setTournamentTab] = useState<'lobby' | 'info' | 'standings' | 'winner'>('lobby');
  const [prefillJoinCode, setPrefillJoinCode] = useState('');

  // Reset navigation cleanly on logout
  useEffect(() => {
    if (!user) {
      setScreen('lobby');
      setActiveRoomId(null);
      setSpectating(null);
      setActiveTournamentId(null);
      setPrefillJoinCode('');
    }
  }, [user]);

  const enterRoom = (room: GameRoomSummary) => {
    setActiveRoomId(room.id);
    if (room.status === 'waiting') {
      setScreen('room_waiting');
    } else {
      setScreen(room.gameType === 'blackjack' ? 'live_blackjack' : 'live_poker');
    }
  };

  const handleNavigate = (nextScreen: AppScreen, param?: string) => {
    if ((nextScreen === 'live_poker' || nextScreen === 'live_blackjack' || nextScreen === 'room_waiting') && param) {
      setActiveRoomId(param);
    }
    if (nextScreen === 'tournament_detail' && param) {
      setActiveTournamentId(param);
      setTournamentTab('lobby');
    }
    if (nextScreen === 'join_private' && param) {
      setPrefillJoinCode(param);
    }
    setScreen(nextScreen);
  };

  const joinRoomById = async (roomIdOrCode: string) => {
    try {
      const res = await apiFetch<{ room: GameRoomSummary }>('/api/rooms/join', {
        method: 'POST',
        body: JSON.stringify({ roomIdOrCode }),
      });
      await refreshWallet();
      enterRoom(res.room);
    } catch {
      setPrefillJoinCode(roomIdOrCode);
      setScreen('join_private');
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-[#060911] flex flex-col items-center justify-center gap-3 text-slate-300">
        <div className="w-10 h-10 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
        <p className="text-sm font-display font-bold tracking-wider bg-gradient-to-r from-cyan-300 via-sky-400 to-purple-400 bg-clip-text text-transparent">
          MIDNIGHT <span className="text-amber-300">POKER CLUB</span>
        </p>
        <p className="text-xs text-slate-400">Where Legends Go All In.</p>
      </div>
    );
  }

  if (!user || passwordRecoveryActive) {
    return (
      <AuthViews
        initialMode={passwordRecoveryActive ? 'new_password' : getInitialAuthMode()}
        onSuccess={() => setScreen('lobby')}
      />
    );
  }

  if (spectating) {
    return (
      <FriendSpectatorView
        roomId={spectating.roomId}
        friendId={spectating.friendId}
        friendName={spectating.username}
        onExit={() => { setSpectating(null); setScreen('friends'); }}
      />
    );
  }

  const isLiveTable = screen === 'live_poker' || screen === 'live_blackjack';

  if (isLiveTable && activeRoomId) {
    return (
      <>
        {screen === 'live_poker' ? (
          <PokerTableView
            roomId={activeRoomId}
            onExit={() => {
              setActiveRoomId(null);
              void refreshSession();
              setScreen('lobby');
            }}
            onOpenTournamentInfo={(tId) => {
              setActiveTournamentId(tId);
              setTournamentTab('info');
              setScreen('tournament_detail');
            }}
          />
        ) : (
          <BlackjackTableView
            roomId={activeRoomId}
            onExit={() => {
              setActiveRoomId(null);
              void refreshSession();
              setScreen('lobby');
            }}
          />
        )}
        <OfflineIndicator />
      </>
    );
  }

  const navItems: Array<{ id: AppScreen; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'lobby', label: 'Home', icon: Home },
    { id: 'holdem_browser', label: 'Games', icon: Spade },
    { id: 'tournament_browser', label: 'Events', icon: Trophy },
    { id: 'friends', label: 'Friends', icon: Users },
    { id: 'inbox', label: 'Inbox', icon: Mail },
    { id: 'profile', label: 'Profile', icon: User },
  ];

  const isGamesActive =
    screen === 'holdem_browser' ||
    screen === 'blackjack_browser' ||
    screen === 'create_private' ||
    screen === 'join_private' ||
    screen === 'room_waiting';

  const isEventsActive =
    screen === 'tournament_browser' ||
    screen === 'create_tournament' ||
    screen === 'tournament_detail';

  return (
    <div className="min-h-[100dvh] w-full overflow-x-hidden flex flex-col bg-[#060911] text-slate-100">
      {/* Persistent Top Lobby Header (matches Reference Image 1 + Desktop 1440px) */}
      <header className="sticky top-0 z-30 border-b border-sky-400/20 bg-[#080d1e]/92 backdrop-blur-xl px-3 sm:px-6 py-2.5 shadow-[0_8px_28px_rgba(0,0,0,0.45)]">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          {/* Left: Player Pill & Brand */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setScreen('profile')}
              className="flex items-center gap-2.5 text-left min-w-0 group"
            >
              <PlayerAvatar avatarId={user.avatarId} username={user.username} size="sm" />
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-display font-bold text-white truncate group-hover:text-cyan-300 transition">
                  {user.username}
                </p>
                <p className="text-[11px] font-mono text-slate-400">Level {user.level}</p>
              </div>
            </button>

            <span className="hidden lg:inline-block h-5 w-px bg-slate-800 mx-1" />
            <button
              type="button"
              onClick={() => setScreen('lobby')}
              className="hidden lg:inline-flex items-center gap-1.5 font-display font-extrabold text-sm tracking-wide bg-gradient-to-r from-cyan-300 via-sky-400 to-purple-400 bg-clip-text text-transparent whitespace-nowrap"
              title="Midnight Poker Club — Where Legends Go All In."
            >
              MIDNIGHT <span className="text-amber-300">POKER CLUB</span>
            </button>
          </div>

          {/* Center: Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1.5" aria-label="Main navigation">
            {navItems.map((item) => {
              const active =
                screen === item.id ||
                (item.id === 'holdem_browser' && isGamesActive) ||
                (item.id === 'tournament_browser' && isEventsActive);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setScreen(item.id)}
                  className={`btn-glossy inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold transition whitespace-nowrap ${
                    active
                      ? 'btn-glossy-blue text-white border border-cyan-300/60'
                      : 'text-slate-300 hover:text-white hover:bg-slate-900/80 shadow-none'
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
            {user.role === 'admin' && (
              <button
                type="button"
                onClick={() => setScreen('admin')}
                className={`btn-glossy inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold transition whitespace-nowrap ${
                  screen === 'admin'
                    ? 'btn-glossy-gold text-slate-950 border border-amber-300/60'
                    : 'text-amber-300/85 hover:text-amber-200 hover:bg-slate-900/80 shadow-none'
                }`}
              >
                <Shield className="w-4 h-4" />
                <span>Admin</span>
              </button>
            )}
          </nav>

          {/* Right: Wallet Balance + Bonus Refill + Install */}
          <div className="flex items-center gap-2 shrink-0">
            {reconnecting && (
              <span
                title="Reconnecting live table socket..."
                className="inline-flex items-center gap-1 text-[11px] text-amber-300 font-mono"
              >
                <Wifi className="w-3.5 h-3.5 animate-pulse" />
                <span className="hidden sm:inline">Syncing</span>
              </span>
            )}

            <PWAInstallButton compact />

            <div className="inline-flex items-center rounded-full border-2 border-amber-400/55 bg-slate-950/90 overflow-hidden shadow-[0_0_16px_rgba(250,204,21,0.2)]">
              <button
                type="button"
                onClick={() => setScreen('wallet')}
                className="flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 text-xs font-mono font-bold text-amber-300 hover:bg-slate-800/80 transition tabular-nums"
                title="Open Virtual Chip Wallet"
              >
                <Coins className="w-3.5 h-3.5 text-amber-400" />
                <span>{(wallet?.chipBalance ?? 0).toLocaleString()}</span>
              </button>
              <button
                type="button"
                onClick={() => setScreen('daily_bonus')}
                className="btn-glossy btn-glossy-green px-2.5 py-1.5 text-slate-950 flex items-center justify-center"
                title="Daily 2,000-Chip Bonus"
              >
                <Plus className="w-4 h-4 stroke-[2.75]" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="flex-1 pb-20 md:pb-8">
        {screen === 'lobby' && <MainLobbyView onNavigate={handleNavigate} />}

        {screen === 'holdem_browser' && (
          <RoomBrowserView
            gameType="holdem"
            onEnterRoom={enterRoom}
            onCreateRoom={() => setScreen('create_private')}
            onBack={() => setScreen('lobby')}
          />
        )}

        {screen === 'blackjack_browser' && (
          <RoomBrowserView
            gameType="blackjack"
            onEnterRoom={enterRoom}
            onCreateRoom={() => setScreen('create_private')}
            onBack={() => setScreen('lobby')}
          />
        )}

        {screen === 'create_private' && (
          <CreatePrivateRoomView
            onCreated={enterRoom}
            onJoinExisting={() => setScreen('join_private')}
            onBack={() => setScreen('lobby')}
          />
        )}

        {screen === 'join_private' && (
          <JoinPrivateRoomView
            prefillCode={prefillJoinCode}
            onJoined={enterRoom}
            onBack={() => setScreen('lobby')}
          />
        )}

        {screen === 'room_waiting' && activeRoomId && (
          <RoomWaitingLobbyView
            roomId={activeRoomId}
            onStartToTable={(room) => {
              setActiveRoomId(room.id);
              setScreen(room.gameType === 'blackjack' ? 'live_blackjack' : 'live_poker');
            }}
            onLeave={() => {
              setActiveRoomId(null);
              void refreshSession();
              setScreen('lobby');
            }}
          />
        )}

        {screen === 'create_tournament' && (
          <CreateTournamentView
            onCreated={(tId) => {
              setActiveTournamentId(tId);
              setTournamentTab('lobby');
              setScreen('tournament_detail');
            }}
            onBack={() => setScreen('tournament_browser')}
          />
        )}

        {screen === 'tournament_browser' && (
          <TournamentBrowserView
            onCreateTournament={() => setScreen('create_tournament')}
            onOpenTournament={(tId) => {
              setActiveTournamentId(tId);
              setTournamentTab('lobby');
              setScreen('tournament_detail');
            }}
            onJoinRoom={(rId) => {
              setActiveRoomId(rId);
              setScreen('live_poker');
            }}
            onBack={() => setScreen('lobby')}
          />
        )}

        {screen === 'tournament_detail' && activeTournamentId && (
          <TournamentDetailView
            tournamentId={activeTournamentId}
            initialTab={tournamentTab}
            onEnterTable={(rId) => {
              setActiveRoomId(rId);
              setScreen('live_poker');
            }}
            onPlayAnother={() => setScreen('tournament_browser')}
            onBack={() => {
              if (activeRoom) {
                setScreen('tournament_browser');
              } else {
                setScreen('tournament_browser');
              }
            }}
          />
        )}

        {screen === 'profile' && (
          <PlayerProfileView onNavigate={(s) => setScreen(s)} onBack={() => setScreen('lobby')} />
        )}

        {screen === 'friends' && (
          <FriendsView
            onBack={() => setScreen('lobby')}
            onJoinFriendRoom={(rId) => void joinRoomById(rId)}
            onWatchFriendRoom={(roomId, friendId, username) => setSpectating({ roomId, friendId, username })}
          />
        )}

        {screen === 'inbox' && (
          <InboxView
            onBack={() => setScreen('lobby')}
            onJoinCode={(code) => {
              setPrefillJoinCode(code);
              setScreen('join_private');
            }}
          />
        )}

        {screen === 'leaderboards' && <LeaderboardsView onBack={() => setScreen('lobby')} />}
        {screen === 'history' && <GameHistoryView onBack={() => setScreen('profile')} />}
        {screen === 'wallet' && (
          <WalletView onBack={() => setScreen('lobby')} onOpenDailyBonus={() => setScreen('daily_bonus')} />
        )}
        {screen === 'daily_bonus' && <DailyBonusView onBack={() => setScreen('lobby')} />}
        {screen === 'settings' && <SettingsView onBack={() => setScreen('profile')} />}
        {screen === 'admin' && <AdminDashboardView onBack={() => setScreen('lobby')} />}
      </main>

      {/* Subtle Virtual-Only Footer */}
      <footer className="hidden md:block border-t border-slate-900 py-3 px-6 text-center text-[11px] text-slate-500">
        Midnight Poker Club · Where Legends Go All In. · Virtual chips for social entertainment only · No monetary value or real-money wagering
      </footer>

      {/* Mobile Bottom Tab Bar (matches Reference Image 1: Home, Games, Inbox, Profile) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-sky-400/20 bg-[#080d1e]/95 backdrop-blur-xl px-2 py-1.5 grid grid-cols-4 gap-1.5 shadow-[0_-8px_24px_rgba(0,0,0,0.6)]"
      >
        {[
          { id: 'lobby' as AppScreen, label: 'Home', icon: Home, active: screen === 'lobby' },
          { id: 'holdem_browser' as AppScreen, label: 'Games', icon: Spade, active: isGamesActive || isEventsActive },
          { id: 'inbox' as AppScreen, label: 'Inbox', icon: Mail, active: screen === 'inbox' || screen === 'friends' },
          { id: 'profile' as AppScreen, label: 'Profile', icon: User, active: screen === 'profile' || screen === 'settings' || screen === 'wallet' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setScreen(tab.id)}
            className={`flex flex-col items-center justify-center py-1.5 rounded-full text-[11px] font-semibold transition min-h-[44px] ${
              tab.active
                ? 'btn-glossy btn-glossy-blue text-white shadow-[0_0_16px_rgba(56,189,248,0.45)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <tab.icon className="w-4 h-4 mb-0.5" />
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      <OfflineIndicator />
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <GameSocketProvider>
          <ClubShell />
        </GameSocketProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
