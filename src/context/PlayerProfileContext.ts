import { createContext, useContext } from 'react';

/** Shared avatar navigation for non-bot players across the lobby and inbox. */
export const OpenPlayerProfileContext = createContext<((userId: string) => void) | null>(null);
export const useOpenPlayerProfile = () => useContext(OpenPlayerProfileContext);
