/** @format */

import type { Guild } from 'discord.js';

export const XERNERX_ACCENT_INT = 0x8b7cf6;

async function collectGuildMetadata(guild: Guild, forceFetch = true) {
	const rolesCollection = forceFetch || guild.roles.cache.size === 0 ? await guild.roles.fetch().catch(() => guild.roles.cache) : guild.roles.cache;
	const serverRoles = Array.from(rolesCollection?.values?.() || [])
		.filter((r: any) => r && r.id && r.id !== guild.id && !r.managed)
		.sort((a: any, b: any) => (b.position || 0) - (a.position || 0))
		.map((r: any) => ({
			id: String(r.id),
			name: String(r.name),
			color: Number(r.color) || 0,
			position: Number(r.position) || 0,
			managed: Boolean(r.managed),
		}));

	const channelsCollection = forceFetch || guild.channels.cache.size === 0 ? await guild.channels.fetch().catch(() => guild.channels.cache) : guild.channels.cache;
	const serverChannels = Array.from(channelsCollection?.values?.() || [])
		.filter((c: any) => c && c.id && (c.type === 0 || c.type === 5 || c.type === 15))
		.sort((a: any, b: any) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0))
		.map((c: any) => ({
			id: String(c.id),
			name: String(c.name),
			type: Number(c.type) || 0,
		}));

	return { serverRoles, serverChannels };
}

export function hasGuildProfile(doc: any): boolean {
	return Boolean(doc && typeof doc === 'object' && (doc._id || doc.docId || doc.id));
}

export async function createGuildProfile(ws: any, guild: Guild, forceFetch = true) {
	if (!ws || !guild?.id) return null;
	const { serverRoles, serverChannels } = await collectGuildMetadata(guild, forceFetch);
	const created = await ws
		.create('yourapps', 'profiles', {
			id: guild.id,
			serverRoles,
			serverChannels,
		})
		.catch(() => null);

	if (hasGuildProfile(created)) {
		return created;
	}

	return await ws
		.update('yourapps', 'profiles', {
			id: guild.id,
			serverRoles,
			serverChannels,
		})
		.catch(() => null);
}

export async function ensureGuildProfile(ws: any, guild: Guild): Promise<{ profile: any; created: boolean }> {
	if (!ws || !guild?.id) return { profile: null, created: false };

	const existing = await ws.get('yourapps', 'profiles', { id: guild.id }).catch(() => null);
	if (!hasGuildProfile(existing)) {
		const profile = await createGuildProfile(ws, guild, true);
		return { profile, created: true };
	}

	const profile = await syncGuildMetadata(ws, guild, true);
	return { profile: profile || existing, created: false };
}

export async function deleteGuildProfile(ws: any, guildId: string) {
	if (!ws || !guildId) return;
	await ws
		.delete('yourapps', 'profiles', {
			id: guildId,
		})
		.catch(() => null);
}

export async function syncGuildMetadata(ws: any, guild: Guild, forceFetch = true) {
	if (!ws || !guild?.id) return null;
	const { serverRoles, serverChannels } = await collectGuildMetadata(guild, forceFetch);

	return await ws
		.update('yourapps', 'profiles', {
			id: guild.id,
			serverRoles,
			serverChannels,
		})
		.catch(() => null);
}

export async function getGuildConfig(ws: any, guildId: string): Promise<any> {
	if (!ws || !guildId) return null;
	const doc = await ws.get('yourapps', 'profiles', { id: guildId }).catch(() => null);
	if (hasGuildProfile(doc)) return doc;
	return {
		id: guildId,
		logChannel: null,
		archiveChannel: null,
		panelChannel: null,
		submissionPings: [],
		adminRoles: [],
		reviewRoles: [],
		blacklistRoles: [],
		dmNotifications: true,
		threadPerSubmission: false,
	};
}

export async function resolveUserAccent(ws: any, userId: string): Promise<number> {
	if (!ws || !userId) return XERNERX_ACCENT_INT;
	try {
		const appearance = await ws.get('xernerx', 'appearance', { id: userId }).catch(() => null);
		const hex = String(appearance?.accent || '')
			.trim()
			.replace(/^#/, '');
		if (/^[0-9a-fA-F]{6}$/.test(hex)) {
			return Number.parseInt(hex, 16);
		}
	} catch {
		// Fall back to default brand accent
	}
	return XERNERX_ACCENT_INT;
}

export function extractItems<T = any>(res: any): T[] {
	if (!res) return [];
	if (Array.isArray(res)) return res;
	if (Array.isArray(res.items)) return res.items;
	return Object.entries(res)
		.filter(([k]) => /^\d+$/.test(k))
		.map(([, v]) => v as T);
}
