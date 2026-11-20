/** @format */

export function isQuestionActive(question: any, answersMap: Map<string, string>): boolean {
	const cond = question?.condition;
	if (!cond || !cond.questionId) return true;
	const refRaw = String(answersMap.get(String(cond.questionId)) ?? '').trim();
	const target = String(cond.value ?? '').trim();
	if (!target) return true;

	const refLower = refRaw.toLowerCase();
	const targetLower = target.toLowerCase();

	switch (cond.operator) {
		case 'not_equals':
			return refLower !== targetLower;
		case 'contains':
			return refLower.includes(targetLower);
		case 'equals':
		default:
			return refLower === targetLower;
	}
}

export function getActiveQuestions(questions: any[], answersMap: Map<string, string>): any[] {
	if (!Array.isArray(questions)) return [];
	return questions.filter((q) => isQuestionActive(q, answersMap));
}

export function validateSingleAnswer(q: any, rawVal: string | undefined, questionNumber: number): string | null {
	const val = String(rawVal ?? '').trim();
	const label = `Question #${questionNumber} (**${q.question}**)`;

	if (q.required !== false && (!val || (q.type === 'checkbox' && val !== 'Yes'))) {
		return q.type === 'checkbox' ? `${label} must be checked to continue.` : `${label} is required.`;
	}

	if (!val) return null;

	if (q.type === 'short' || q.type === 'paragraph') {
		const minLen = Number(q.minLength) || 0;
		const maxLen = Number(q.maxLength) || 0;
		if (minLen > 1 && val.length < minLen) {
			return `${label} requires at least **${minLen}** characters.`;
		}
		if (maxLen > 0 && val.length > maxLen) {
			return `${label} must be **${maxLen}** characters or fewer.`;
		}
	}

	if (q.type === 'number') {
		const num = Number(val);
		if (Number.isNaN(num)) {
			return `${label} expects a valid number (got \`${val.slice(0, 40)}\`).`;
		}
		if (q.minValue !== null && q.minValue !== undefined && num < Number(q.minValue)) {
			return `${label} must be at least **${q.minValue}**.`;
		}
		if (q.maxValue !== null && q.maxValue !== undefined && num > Number(q.maxValue)) {
			return `${label} must be **${q.maxValue}** or less.`;
		}
	}

	const pattern = String(q.validationPattern || 'none');
	if (pattern === 'url' && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(val)) {
		return `${label} must be a valid URL starting with \`http://\` or \`https://\`.`;
	}
	if (pattern === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
		return `${label} must be a valid email address.`;
	}
	if (pattern === 'discord_id' && !/^\d{16,21}$/.test(val)) {
		return `${label} must be a valid numeric Discord ID.`;
	}
	if (pattern === 'regex' && q.validationRegex) {
		try {
			const re = new RegExp(String(q.validationRegex));
			if (!re.test(val)) {
				return `${label} does not match the required format.`;
			}
		} catch {
			// Ignore invalid custom regex
		}
	}

	return null;
}
