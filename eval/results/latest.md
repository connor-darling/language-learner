# Evaluation results

26 utterances, streamed in real time at 50 ms per chunk. Audio is synthetic and was generated with AssemblyAI's own TTS (see `eval/synthesize.mts`), so treat this as a harness check, not a verdict.

## Accuracy

Word error rate by kind of utterance (lower is better), and how often a target-language phrase spoken inside an English sentence was transcribed intact.

| Provider | WER: ask | WER: attempt | WER: mixed | Mixed phrases intact | Language identified |
|---|---|---|---|---|---|
| assemblyai | 0.0% | 3.1% | 0.0% | 100% | 100% |
| deepgram | 0.0% | 50.0% | 8.1% | 71% | 47% |

## Does the transcript keep the learner's mistake?

Each near-miss utterance contains a real learner error. A tutor can only correct it if the transcript says what was actually said. "Silently corrected" means the model wrote the phrase the tutor had taught instead, which would earn the learner false praise. The `+keyterms` rows boost the taught phrase: that should help recognise a correct attempt (last column), and the question is whether it also hides mistakes.

| Provider | Kept the mistake | Silently corrected | Something else | WER: correct attempts |
|---|---|---|---|---|
| assemblyai | 4/6 | 1/6 | 1/6 | 3.1% |
| assemblyai+keyterms | 5/6 | 1/6 | 0/6 | 0.0% |
| deepgram | 1/6 | 1/6 | 4/6 | 50.0% |
| deepgram+keyterms | 1/6 | 1/6 | 4/6 | 12.5% |

## Turn detection and latency

Every utterance is one turn. More than one final means the provider cut the learner off mid-utterance; none means it never decided they had finished. Latency is from the end of speech to the complete transcript, which includes each provider's endpointing wait: it is the delay a voice agent actually experiences before it can respond.

| Provider | Exactly one turn | Split | Missed | Latency p50 | Latency p90 |
|---|---|---|---|---|---|
| assemblyai | 100% | 0 | 0 | 514 ms | 1301 ms |
| deepgram | 100% | 0 | 0 | 460 ms | 534 ms |

## Every transcript

| Utterance | Said | assemblyai | assemblyai+keyterms | deepgram | deepgram+keyterms |
|---|---|---|---|---|---|
| ask-es | How do you say good morning in Spanish? | How do you say good morning in Spanish? |  | How do you say good morning in Spanish? |  |
| ask-fr | How do I say nice to meet you in French? | How do I say nice to meet you in French? |  | How do I say nice to meet you in French? |  |
| ask-de | What's the German word for train station? | What's the German word for train station? |  | What's the German word for train station? |  |
| ask-it | Can you teach me how to order a coffee in Italian? | Can you teach me how to order a coffee in Italian? |  | Can you teach me how to order a coffee in Italian? |  |
| ask-pt | How would I ask where the bathroom is in Portuguese? | How would I ask where the bathroom is in Portuguese? |  | How would I ask where the bathroom is in Portuguese? |  |
| att-es-1 | Buenos días. | Buenos días. | Buenos días. | Buenos días. | Buenos días. |
| att-es-2 | Mucho gusto en conocerte. | Mucho gusto en conocerte. | Mucho gusto en conocerte. | Mucho gusto and conocerte. | Mucho gusto en conocerte. |
| att-fr-1 | Enchanté. | Enchantée. | Enchanté. | Enchante. | Enchanté. |
| att-fr-2 | Je voudrais un café, s'il vous plaît. | Je voudrais un café, s'il vous plaît. | Je voudrais un café, s'il vous plaît. | Je voudrais un café, s'il vous plaît. | Je voudrais un café, s'il vous plaît. |
| att-de-1 | Guten Morgen. | Guten Morgen! | Guten Morgen! | Guggen Morgan? | Guggen Morgan? |
| att-de-2 | Wo ist der Bahnhof? | Wo ist der Bahnhof? | Wo ist der Bahnhof? | Whoa, Stir Bonhoef? | Wo ist der Bahnhof? |
| att-it-1 | Buongiorno. | Buongiorno! | Buongiorno! | Buongiorno. | Buongiorno. |
| att-it-2 | Vorrei un caffè, per favore. | Vorrei un caffè, per favore. | Vorrei un caffè, per favore. | Fore un cafe, por favore. | Vorrei un caffè, per favore. |
| att-pt-1 | Bom dia. | Bom dia! | Bom dia. | Bondia. | Bondia. |
| att-pt-2 | Onde fica o banheiro? | Onde fica o banheiro? | Onde fica o banheiro? | Onda fika o banyero? | Onde fica o banheiro? |
| mix-es | What does mucho gusto mean? | What does mucho gusto mean? |  | What does Mucho Gusto mean? |  |
| mix-fr | Is it bonjour or bonsoir in the evening? | Is it bonjour or bonsoir in the evening? |  | Is it bonjour or bonsoir in the evening? |  |
| mix-de | Can I say guten Abend late at night? | Can I say Guten Abend late at night? |  | Can I say Guten Abend late at night? |  |
| mix-it | How is grazie mille different from just grazie? | How is grazie mille different from just grazie? |  | How is Graziamile different from just Graziae? |  |
| mix-pt | Does obrigado change if a woman says it? | Does obrigado change if a woman says it? |  | Does Obrigado change if a woman says it? |  |
| miss-es-1 | Buenos tardes. | Buenas tardes. | Buenas tardes. | Buenas tardes. | Buenas tardes. |
| miss-es-2 | Estoy caliente. | ¿Estoy caliente? | ¿Estoy caliente? | ¿Estoy caliente? | ¿Estoy caliente? |
| miss-fr-1 | Je suis faim. | Je suis faim. | Je suis faim. | J Sui Fame. | J Sui Fame. |
| miss-de-1 | Ich bin kalt. | Ich bin kalt. | Ich bin kalt. | Iq bin Colt. | Iq bin Kalt. |
| miss-it-1 | Io sono fame. | Io sono fame. | Io sono fame. | Ayo Sonofami. | Ayo sono fame. |
| miss-pt-1 | Eu sou com fome. | You so calm, fam. | Eu sou com fome. | Uso confirm. | Uso confirm. |
