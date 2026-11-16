/** @format */

import { PermissionFlagsBits, type GuildMember } from 'discord.js';

export function isGuildAdmin(member: GuildMember | null | undefined, guildConfig: any): boolean {
	if (!member) return false;
	if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)) {
		return true;
	}
	const adminRoles: string[] = Array.isArray(guildConfig?.adminRoles) ? guildConfig.adminRoles.map(String) : [];
	return adminRoles.some((roleId) => member.roles.cache.has(roleId));
}

export function isGuildReviewer(member: GuildMember | null | undefined, guildConfig: any): boolean {
	if (!member) return false;
	if (isGuildAdmin(member, guildConfig)) return true;
	const reviewRoles: string[] = Array.isArray(guildConfig?.reviewRoles) ? guildConfig.reviewRoles.map(String) : [];
	return reviewRoles.some((roleId) => member.roles.cache.has(roleId));
}

export function formatDurationSeconds(seconds: number): string {
	const s = Math.max(0, Math.ceil(seconds));
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.ceil(s / 60)}m`;
	if (s < 86400) return `${Math.ceil(s / 3600)}h`;
	return `${Math.ceil(s / 86400)}d`;
}

export function checkApplicantEligibility(params: { member: GuildMember; guildConfig: any; position: any; latestSubmission: any | null }): { ok: true } | { ok: false; reason: string } {
	const { member, guildConfig, position, latestSubmission } = params;

	if (!position || position.state === 'closed') {
		return { ok: false, reason: `Applications for **${position?.name || 'this position'}** are currently closed.` };
	}

	if (!Array.isArray(position.questions) || position.questions.length === 0) {
		return { ok: false, reason: `**${position.name}** does not have any questions configured yet.` };
	}

	const blacklistRoles: string[] = Array.isArray(guildConfig?.blacklistRoles) ? guildConfig.blacklistRoles.map(String) : [];
	if (blacklistRoles.some((r) => member.roles.cache.has(r))) {
		return { ok: false, reason: 'You hold a role that is restricted from submitting applications in this server.' };
	}

	const restrictedRoles: string[] = Array.isArray(position.restrictedRoles) ? position.restrictedRoles.map(String) : [];
	if (restrictedRoles.some((r) => member.roles.cache.has(r))) {
		return { ok: false, reason: `You hold a role that is not eligible to apply for **${position.name}**.` };
	}

	const requiredRoles: string[] = Array.isArray(position.requiredRoles) ? position.requiredRoles.map(String) : [];
	const missingRequired = requiredRoles.filter((r) => !member.roles.cache.has(r));
	if (missingRequired.length > 0) {
		return {
			ok: false,
			reason: `You are missing required role(s) for **${position.name}**: ${missingRequired.map((r) => `<@&${r}>`).join(', ')}.`,
		};
	}

	const minJoinSec = Number(position.minimumJoinTime) || 0;
	if (minJoinSec > 0 && member.joinedTimestamp) {
		const elapsedSec = (Date.now() - member.joinedTimestamp) / 1000;
		if (elapsedSec < minJoinSec) {
			return {
				ok: false,
				reason: `You must be a member of this server for **${formatDurationSeconds(minJoinSec)}** before applying (**${formatDurationSeconds(minJoinSec - elapsedSec)}** remaining).`,
			};
		}
	}

	if (latestSubmission) {
		if (latestSubmission.status === 'pending') {
			return {
				ok: false,
				reason: `You already have a **pending** application (\`${latestSubmission.id}\`) for **${position.name}**.`,
			};
		}

		const cooldownSec = Number(position.cooldown) || 0;
		if (cooldownSec > 0 && latestSubmission.createdAt) {
			const lastMs = new Date(latestSubmission.createdAt).getTime();
			if (!Number.isNaN(lastMs)) {
				const elapsedSec = (Date.now() - lastMs) / 1000;
				if (elapsedSec < cooldownSec) {
					return {
						ok: false,
						reason: `Please wait **${formatDurationSeconds(cooldownSec - elapsedSec)}** before applying for **${position.name}** again.`,
					};
				}
			}
		}
	}

	return { ok: true };
}
