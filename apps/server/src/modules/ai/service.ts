import { ApiError } from '../../lib/envelope';
import { AiSession, TransporterOffer, TransportRequest, User } from '../../models';
import type { AiChatResponse, AiTool, Language } from '@kisanpool/shared';
import { AI_TOOLS } from '@kisanpool/shared';
import { chatCompletion, sarvamConfigured, type ChatTurn } from './sarvam';
import { findCrop, findMandi, findQuantityKg, normaliseDigits } from './places';
import { runTool, STATE_CHANGING } from './tools';

const SYSTEM_PROMPT = `You are Servo AI, the voice assistant inside KisanPool, an app that helps Indian farmers share truck space to send produce to a mandi.

You extract intent only. You NEVER state a price, vehicle, ETA, booking id or trip status unless it came back from a tool result given to you. You never take payment — accepting a match hands the farmer to the payment screen.

Reply with JSON only, no prose around it:
{"tool": <one of ${AI_TOOLS.join(', ')} or null>, "args": {...}, "reply": "<short reply in the user's language>", "needsConfirmation": <true if the tool changes state>}

If the request is ambiguous or a required detail is missing, set tool to null and ask ONE short follow-up question in "reply". Never guess a quantity, crop or destination.`;

interface ModelDecision {
  tool: AiTool | null;
  args: Record<string, unknown>;
  reply: string;
  needsConfirmation?: boolean;
}

export async function chat(args: {
  userId: string;
  sessionId: string;
  message: string;
  language: Language;
}): Promise<AiChatResponse> {
  const session =
    (await AiSession.findOne({ userId: args.userId, sessionKey: args.sessionId })) ??
    (await AiSession.create({
      userId: args.userId,
      sessionKey: args.sessionId,
      detectedLanguage: args.language,
      history: [],
    }));

  session.detectedLanguage = args.language;
  session.history.push({ role: 'user', content: args.message, ts: new Date() });

  // a pending state-changing tool is waiting on a spoken yes (ADR-014)
  if (session.pendingConfirmation) {
    const pending = session.pendingConfirmation;

    if (isAffirmative(args.message)) {
      // Disarm and persist BEFORE running the tool. If the tool then fails, the
      // confirmation must not stay armed — otherwise it hijacks every later turn
      // and the farmer can never get out of it.
      session.pendingConfirmation = undefined;
      await session.save();

      const result = await runTool(
        pending.tool as AiTool,
        (pending.args ?? {}) as Record<string, unknown>,
        { userId: args.userId },
      );
      return finish(session, args.language, replyForResult(pending.tool as AiTool, result), result);
    }

    if (isNegative(args.message)) {
      session.pendingConfirmation = undefined;
      return finish(session, args.language, 'Alright, I have not done it.');
    }

    return finish(session, args.language, `${pending.summary} Should I go ahead?`);
  }

  const decision = await decide(session.history, args.message, args.userId);

  if (!decision.tool) {
    return finish(session, args.language, decision.reply);
  }
  if (!AI_TOOLS.includes(decision.tool)) {
    throw new ApiError('AI_TOOL_ERROR', 'I am not able to do that.');
  }

  // state-changing tools must state what they will do and get a yes first
  if (STATE_CHANGING.includes(decision.tool) && decision.needsConfirmation !== false) {
    const summary = decision.reply || 'I will do that now.';
    session.pendingConfirmation = {
      tool: decision.tool,
      summary,
      args: decision.args,
    };
    return finish(session, args.language, `${summary} Should I go ahead?`, undefined, {
      tool: decision.tool,
      summary,
    });
  }

  const result = await runTool(decision.tool, decision.args, { userId: args.userId });
  return finish(session, args.language, replyForResult(decision.tool, result), result);
}

/**
 * With no Sarvam key configured the assistant falls back to a small deterministic
 * parser. It understands less — but it still never invents a fact, which is the
 * property that matters (Golden Rule).
 */
async function decide(
  history: ChatTurn[] | unknown[],
  message: string,
  userId: string,
): Promise<ModelDecision> {
  if (!sarvamConfigured()) return ruleBasedIntent(message, userId);

  const turns: ChatTurn[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(history as Array<{ role: string; content: string }>)
      .slice(-8)
      .map((h) => ({ role: h.role as ChatTurn['role'], content: h.content })),
    { role: 'user', content: message },
  ];

  try {
    const raw = await chatCompletion(turns);
    const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const parsed = JSON.parse(json) as ModelDecision;
    return {
      tool: parsed.tool ?? null,
      args: parsed.args ?? {},
      reply: parsed.reply ?? '',
      needsConfirmation: parsed.needsConfirmation,
    };
  } catch (err) {
    console.warn('[ai] falling back to rule-based intent', err);
    return ruleBasedIntent(message, userId);
  }
}

async function ruleBasedIntent(message: string, userId: string): Promise<ModelDecision> {
  const text = normaliseDigits(message).toLowerCase();

  // \b so "somewhere" is not read as "where"
  if (/\b(status|where|track)\b|कहाँ|कुठे/.test(text)) {
    return { tool: 'getTripStatus', args: {}, reply: '', needsConfirmation: false };
  }

  // Accepting names a real vehicle and a real price, both read from the database —
  // and still requires a spoken yes before anything happens.
  if (/\b(accept|book|confirm)\b|बुक|स्वीकार/.test(text)) {
    const request = await TransportRequest.findOne({
      farmerId: userId,
      state: { $in: ['OPEN', 'TRANSPORTER_INTERESTED'] },
    }).sort({ createdAt: -1 });

    if (!request) {
      return { tool: null, args: {}, reply: 'You have no open request to book right now.' };
    }

    const best = await TransporterOffer.findOne({
      requestId: request._id,
      state: 'INTERESTED',
    }).sort({ quotedPrice: 1 });
    if (!best) {
      return { tool: null, args: {}, reply: 'No transporter has offered for this yet.' };
    }

    const owner = await User.findById(best.transporterId);

    return {
      tool: 'acceptMatch',
      args: { requestId: String(request._id), offerId: String(best._id) },
      reply: `I will book ${owner?.name ?? 'that transporter'} for about ₹${Math.round(best.quotedPrice)}. You pay after delivery.`,
    };
  }

  if (/\bcancel\b|रद्द/.test(text)) {
    return {
      tool: null,
      args: {},
      reply: 'Which trip would you like to cancel? You can also cancel it from the trip screen.',
    };
  }
  if (/\b(vehicle|truck|match)\b|गाडी|ट्रक/.test(text)) {
    return { tool: 'findMatchingVehicles', args: {}, reply: '', needsConfirmation: false };
  }

  // Only what was actually said is filled in. Anything missing is asked for,
  // never assumed — that is the whole point of the fallback.
  const quantityKg = findQuantityKg(text);
  const crop = findCrop(text);
  const mandi = findMandi(text);
  const wantsTransport = /\b(send|transport|mandi)\b|पाठव|भेज|मंडी|घेऊन/.test(text);

  if (wantsTransport || quantityKg || mandi) {
    if (quantityKg && crop && mandi) {
      return {
        tool: 'createTransportRequest',
        args: {
          cropType: crop,
          quantityKg,
          pickupLocation: 'default',
          destination: { name: mandi.name, lat: mandi.lat, lng: mandi.lng },
        },
        reply: `I will book transport for ${quantityKg} kg of ${crop.toLowerCase()} to ${mandi.name}.`,
      };
    }

    const missing = [
      !crop ? 'which crop' : null,
      !quantityKg ? 'how many kilos' : null,
      !mandi ? 'which mandi' : null,
    ].filter(Boolean);

    return {
      tool: null,
      args: {},
      reply: `Please tell me ${missing.join(' and ')}.`,
    };
  }

  return {
    tool: null,
    args: {},
    reply: 'Tell me what you want to send, how much, and to which mandi.',
  };
}

function replyForResult(tool: AiTool, result: unknown): string {
  switch (tool) {
    case 'getUserProfile': {
      const profile = result as { name?: string };
      return profile.name ? `You are signed in as ${profile.name}.` : 'Here is your profile.';
    }
    case 'findMatchingVehicles': {
      const matches = result as Array<{ farmerShare: number }>;
      if (!matches.length) return 'No vehicle is free near you right now.';
      return `I found ${matches.length} vehicle${matches.length > 1 ? 's' : ''}. The best one costs you ₹${matches[0].farmerShare}.`;
    }
    case 'createTransportRequest':
      return 'Your request is created. I am showing you the matching vehicles.';
    case 'acceptMatch': {
      const booked = result as { estimatedShare?: number };
      return `Booked. Your share is about ₹${Math.round(booked.estimatedShare ?? 0)} — it may drop further if another farmer joins, and you pay after delivery.`;
    }
    case 'getTripStatus': {
      const trip = result as { status?: string; destination?: string };
      return `Your trip to ${trip.destination} is ${String(trip.status).toLowerCase().replace('_', ' ')}.`;
    }
    case 'cancelRequest':
      return 'I have cancelled that request.';
    default:
      return 'Done.';
  }
}

async function finish(
  session: { history: unknown[]; save: () => Promise<unknown> },
  language: Language,
  reply: string,
  data?: unknown,
  pendingConfirmation?: { tool: AiTool; summary: string },
): Promise<AiChatResponse> {
  session.history.push({ role: 'assistant', content: reply, ts: new Date() });
  await session.save();

  return {
    reply,
    language,
    data,
    pendingConfirmation,
    action: navigationFor(data),
  };
}

/** The assistant navigates; it never performs the destination's action itself. */
function navigationFor(data: unknown): AiChatResponse['action'] {
  if (!data || typeof data !== 'object') return undefined;

  if ('handoff' in data) {
    return { type: 'NAVIGATE', route: String((data as { handoff: string }).handoff) };
  }
  // a freshly created request goes to its offers list; a confirmed one to its trip
  if ('_id' in data && 'state' in data) {
    const request = data as { _id: string; state: string; tripId?: string };
    if (request.state === 'CONFIRMED' && request.tripId) {
      return { type: 'NAVIGATE', route: `/(farmer)/trips/${request.tripId}` };
    }
    return { type: 'NAVIGATE', route: `/(farmer)/requests/${request._id}/offers` };
  }
  return undefined;
}

function isAffirmative(text: string): boolean {
  return /^(yes|yeah|yep|ok|okay|sure|go ahead|haan|हाँ|हो|होय|ठीक|करा|करो)\b/i.test(text.trim());
}

function isNegative(text: string): boolean {
  return /^(no|nope|cancel|nahi|नहीं|नको|नाही)\b/i.test(text.trim());
}
