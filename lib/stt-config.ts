// Turn-detection presets, shared by the app and the evaluation harness so the
// harness measures the configuration the agent actually runs.
//
// After `min_turn_silence` AssemblyAI checks whether the turn reads as
// complete and ends it if so. A turn that doesn't read as complete, or that
// ends in something name-like that might continue, is held until
// `max_turn_silence`.
//
// How these values were chosen (README, decision 4): a 640 ms maximum measured
// fastest on the synthetic evaluation set, but in the first live session it cut
// a real speaker off at "Um, I would like to learn how to say...". A 1600 ms
// maximum for attempts made every reply after a taught phrase feel slow,
// because attempts that end in a name are held for the full wait.

/** Ordinary back-and-forth. AssemblyAI's recommended values for voice agents. */
export const SILENCE_CONVERSATION = { min_turn_silence: 100, max_turn_silence: 1000 };

/**
 * The turn right after the tutor teaches a phrase. Learners attempting
 * unfamiliar words pause between them, so the tutor waits a little longer
 * before deciding they have finished.
 */
export const SILENCE_ATTEMPT = { min_turn_silence: 200, max_turn_silence: 1280 };

export const STT_MODEL = "assemblyai-stt-3-7-realtime-agent";
export const STT_SAMPLE_RATE = 16000;
