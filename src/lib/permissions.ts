/** @format */

import { PermissionFlagsBits, PermissionsBitField, type APIInteractionGuildMember, type Guild, type GuildMember } from 'discord.js';

export type MemberLike = GuildMember | APIInteractionGuildMember;

function snowflakeToTimestampMs(id?: string | null): number | null {
	if (!id || !/^\d{16,21}$/.test(String(id))) return null;
	try {
		return Number((BigInt(String(id)) >> 22n) + 1420070400000n);
	} catch {
		return null;
	}
}

export function isFullGuildMember(member: unknown): member is GuildMember {
	if (!member || typeof member !== 'object') return false;
	const m = member as any;
	return Boolean(m.roles && typeof m.roles === 'object' && 'cache' in m.roles && typeof m.permissions?.has === 'function');
}

export function memberHasRole(member: MemberLike | null | undefined, roleId: string): boolean {
	if (!member || !roleId) return false;
	if (isFullGuildMember(member)) {
		return member.roles.cache.has(roleId);
	}
	const rawRoles = (member as APIInteractionGuildMember).roles;
	return Array.isArray(rawRoles) ? rawRoles.includes(roleId) : false;
}

export function getMemberRoleIds(member: MemberLike | null | undefined, guildId?: string): string[] {
	if (!member) return [];
	if (isFullGuildMember(member)) {
		return Array.from(member.roles.cache.keys()).filter((id) => !guildId || id !== guildId);
	}
	const rawRoles = (member as APIInteractionGuildMember).roles;
	return Array.isArray(rawRoles) ? rawRoles.map(String).filter((id) => !guildId || id !== guildId) : [];
}

export function memberHasAdminOrManageGuild(member: MemberLike | null | undefined, memberPermissions?: Readonly<PermissionsBitField> | null): boolean {
	if (memberPermissions?.has(PermissionFlagsBits.Administrator) || memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
		return true;
	}
	if (!member) return false;
	if (isFullGuildMember(member)) {
		return member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
	}
	const rawPerms = (member as APIInteractionGuildMember).permissions;
	if (typeof rawPerms === 'string' && /^\d+$/.test(rawPerms)) {
		const bf = new PermissionsBitField(BigInt(rawPerms));
		return bf.has(PermissionFlagsBits.Administrator) || bf.has(PermissionFlagsBits.ManageGuild);
	}
	return false;
}

/**
 * Resolves the interaction's member without making an unnecessary Discord REST round-trip
 * when `interaction.member` is already attached on the interaction payload.
 */
export async function resolveInteractionMember(interaction: { guild?: Guild | null; member?: GuildMember | APIInteractionGuildMember | null; user: { id: string } }): Promise<MemberLike | null> {
	if (interaction.member) {
		return interaction.member;
	}
	if (!interaction.guild) return null;
	return await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

export function isGuildAdmin(member: MemberLike | null | undefined, guildConfig: any, memberPermissions?: Readonly<PermissionsBitField> | null): boolean {
	if (!member && !memberPermissions) return false;
	if (memberHasAdminOrManageGuild(member, memberPermissions)) {
		return true;
	}
	const adminRoles: string[] = Array.isArray(guildConfig?.adminRoles) ? guildConfig.adminRoles.map(String) : [];
	return adminRoles.some((roleId) => memberHasRole(member, roleId));
}

export function isGuildReviewer(member: MemberLike | null | undefined, guildConfig: any, memberPermissions?: Readonly<PermissionsBitField> | null): boolean {
	if (!member && !memberPermissions) return false;
	if (isGuildAdmin(member, guildConfig, memberPermissions)) return true;
	const reviewRoles: string[] = Array.isArray(guildConfig?.reviewRoles) ? guildConfig.reviewRoles.map(String) : [];
	return reviewRoles.some((roleId) => memberHasRole(member, roleId));
}

export function isPositionReviewer(member: MemberLike | null | undefined, guildConfig: any, position?: any, memberPermissions?: Readonly<PermissionsBitField> | null): boolean {
	if (!member && !memberPermissions) return false;
	if (isGuildAdmin(member, guildConfig, memberPermissions)) return true;
	const posReviewRoles: string[] = Array.isArray(position?.reviewRolesOverride) ? position.reviewRolesOverride.map(String).filter(Boolean) : [];
	if (posReviewRoles.length > 0) {
		return posReviewRoles.some((roleId) => memberHasRole(member, roleId));
	}
	return isGuildReviewer(member, guildConfig, memberPermissions);
}

export function isAnyPositionReviewer(member: MemberLike | null | undefined, guildConfig: any, positions?: any[], memberPermissions?: Readonly<PermissionsBitField> | null): boolean {
	if (!member && !memberPermissions) return false;
	if (isGuildReviewer(member, guildConfig, memberPermissions)) return true;
	if (Array.isArray(positions)) {
		return positions.some((pos) => isPositionReviewer(member, guildConfig, pos, memberPermissions));
	}
	return false;
}

export function formatDurationSeconds(seconds: number): string {
	const s = Math.max(0, Math.ceil(seconds));
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.ceil(s / 60)}m`;
	if (s < 86400) return `${Math.ceil(s / 3600)}h`;
	return `${Math.ceil(s / 86400)}d`;
}

export function checkApplicantEligibility(params: {
	member: MemberLike | null;
	memberPermissions?: Readonly<PermissionsBitField> | null;
	userId?: string;
	userCreatedTimestamp?: number | null;
	guildConfig: any;
	position: any;
	latestSubmission: any | null;
	activeSubmissionCount?: number;
	approvedSubmissionCount?: number;
}): { ok: true } | { ok: false; reason: string } {
	const { member, memberPermissions, userId, userCreatedTimestamp, guildConfig, position, latestSubmission, activeSubmissionCount, approvedSubmissionCount } = params;
	const nowMs = Date.now();

	if (!position) {
		return { ok: false, reason: 'This position no longer exists.' };
	}

	if (position.opensAt) {
		const opensMs = new Date(position.opensAt).getTime();
		if (!Number.isNaN(opensMs) && opensMs > nowMs && position.state === 'closed') {
			return {
				ok: false,
				reason: `Applications for **${position.name}** open <t:${Math.floor(opensMs / 1000)}:R>.`,
			};
		}
	}

	if (position.closesAt) {
		const closesMs = new Date(position.closesAt).getTime();
		if (!Number.isNaN(closesMs) && closesMs <= nowMs) {
			return {
				ok: false,
				reason: `The application deadline for **${position.name}** has passed.`,
			};
		}
	}

	if (position.state === 'closed') {
		return { ok: false, reason: `Applications for **${position.name || 'this position'}** are currently closed.` };
	}

	if (!Array.isArray(position.questions) || position.questions.length === 0) {
		return { ok: false, reason: `**${position.name}** does not have any questions configured yet.` };
	}

	const maxSubs = Number(position.maxSubmissions) || 0;
	if (maxSubs > 0 && typeof activeSubmissionCount === 'number' && activeSubmissionCount >= maxSubs) {
		return { ok: false, reason: `**${position.name}** has reached its maximum of **${maxSubs}** submissions.` };
	}

	const maxApps = Number(position.maxApprovals) || 0;
	if (maxApps > 0 && typeof approvedSubmissionCount === 'number' && approvedSubmissionCount >= maxApps) {
		return { ok: false, reason: `All **${maxApps}** available spots for **${position.name}** have been filled.` };
	}

	const adminBypass = isGuildAdmin(member, guildConfig, memberPermissions);

	const blacklistRoles: string[] = Array.isArray(guildConfig?.blacklistRoles) ? guildConfig.blacklistRoles.map(String) : [];
	if (!adminBypass && blacklistRoles.some((r) => memberHasRole(member, r))) {
		return { ok: false, reason: 'You hold a role that is restricted from submitting applications in this server.' };
	}

	const restrictedRoles: string[] = Array.isArray(position.restrictedRoles) ? position.restrictedRoles.map(String) : [];
	if (!adminBypass && restrictedRoles.some((r) => memberHasRole(member, r))) {
		return { ok: false, reason: `You hold a role that is not eligible to apply for **${position.name}**.` };
	}

	const requiredRoles: string[] = Array.isArray(position.requiredRoles) ? position.requiredRoles.map(String) : [];
	if (!adminBypass && requiredRoles.length > 0 && !requiredRoles.some((r) => memberHasRole(member, r))) {
		return {
			ok: false,
			reason: `You need at least one required role for **${position.name}**: ${requiredRoles.map((r) => `<@&${r}>`).join(', ')}.`,
		};
	}

	const minAccountSec = Number(position.minimumAccountAge) || 0;
	const resolvedCreatedMs = userCreatedTimestamp ?? (isFullGuildMember(member) ? member.user?.createdTimestamp : null) ?? snowflakeToTimestampMs(userId || (member as any)?.user?.id);
	if (!adminBypass && minAccountSec > 0 && resolvedCreatedMs) {
		const acctElapsedSec = (nowMs - resolvedCreatedMs) / 1000;
		if (acctElapsedSec < minAccountSec) {
			return {
				ok: false,
				reason: `Your Discord account must be at least **${formatDurationSeconds(minAccountSec)}** old (**${formatDurationSeconds(minAccountSec - acctElapsedSec)}** remaining).`,
			};
		}
	}

	const minJoinSec = Number(position.minimumJoinTime) || 0;
	const rawJoined = !isFullGuildMember(member) ? (member as APIInteractionGuildMember | null)?.joined_at : null;
	const joinedMs = isFullGuildMember(member) ? member.joinedTimestamp : rawJoined ? new Date(rawJoined).getTime() : null;
	if (!adminBypass && minJoinSec > 0 && joinedMs && !Number.isNaN(joinedMs)) {
		const elapsedSec = (nowMs - joinedMs) / 1000;
		if (elapsedSec < minJoinSec) {
			return {
				ok: false,
				reason: `You must be a member of this server for **${formatDurationSeconds(minJoinSec)}** before applying (**${formatDurationSeconds(minJoinSec - elapsedSec)}** remaining).`,
			};
		}
	}

	if (latestSubmission) {
		if (['pending', 'interview', 'needs_info'].includes(String(latestSubmission.status))) {
			return {
				ok: false,
				reason: `You already have an active application (\`${latestSubmission.id}\`) for **${position.name}**. Run \`/submissions\` to check its status.`,
			};
		}

		const cooldownSec = Number(position.cooldown) || 0;
		if (!adminBypass && cooldownSec > 0 && latestSubmission.createdAt && latestSubmission.status !== 'withdrawn') {
			const lastMs = new Date(latestSubmission.createdAt).getTime();
			if (!Number.isNaN(lastMs)) {
				const elapsedSec = (nowMs - lastMs) / 1000;
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
