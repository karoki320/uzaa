'use client';
// Bluetooth Print (Android app) helpers shared by the till and the sales screen.
const KEY = 'uzaa_paper';
export const paperWidth = () => { try { return localStorage.getItem(KEY) === '48' ? 48 : 32; } catch { return 32; } };
export const setPaperWidth = (w) => { try { localStorage.setItem(KEY, String(w)); } catch {} };
export const schemeUrl = (u) => `my.bluetoothprint.scheme://${u}`;
