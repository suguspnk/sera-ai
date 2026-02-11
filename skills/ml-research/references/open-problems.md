# Open Problems & Research Directions

## Theory-Practice Gaps

### Why Does Deep Learning Work?
- Overparameterized networks generalize despite fitting training data exactly
- Loss landscapes are non-convex yet optimization succeeds
- Implicit regularization of SGD is not fully understood
- **Entry point:** Benign overfitting literature, NTK theory limitations

### Transformer Theory
- Why do transformers work so well? (theoretical understanding lags practice)
- In-context learning mechanisms
- Scaling laws — empirical but lacking theory
- **Entry point:** "Transformers learn in-context by gradient descent" (von Oswald et al.)

### Emergence & Phase Transitions
- Capabilities appear suddenly at scale
- No predictive theory for when emergence occurs
- Connection to statistical physics phase transitions
- **Entry point:** "Emergent Abilities of Large Language Models" (Wei et al.)

## Active Research Areas

### Mechanistic Interpretability
- Understanding internal representations
- Circuits and features in neural networks
- Theoretical grounding still emerging
- **Key groups:** Anthropic interpretability team, Chris Olah's work

### Grokking & Generalization
- Networks can suddenly generalize long after memorizing
- Connection to representation learning dynamics
- **Key paper:** "Grokking: Generalization Beyond Overfitting" (Power et al.)

### Neural Scaling Laws
- Power-law relationships between compute, data, parameters, and loss
- Chinchilla scaling laws
- Theoretical derivation from first principles is open
- **Entry point:** Kaplan et al. (2020), Hoffmann et al. (2022)

### Alignment & Safety Theory
- Formal frameworks for AI alignment
- Reward hacking, goal misgeneralization
- Cooperative AI theory
- **Entry point:** MIRI technical agenda, Anthropic core views

## Classical Open Problems

### Computational Learning Theory
- Proper vs improper learning gaps
- Average-case complexity of learning
- Hardness of learning neural networks (cryptographic assumptions)
- **Entry point:** "Hardness of Learning" literature

### Statistical Learning
- Optimal rates for neural network estimation
- Adaptive estimation without knowing smoothness
- High-dimensional regression beyond linear models

### Optimization
- Global convergence guarantees for non-convex problems
- Understanding loss landscape geometry
- Implicit bias of different optimizers

## Promising Thesis Directions

1. **Scaling law theory** — derive power laws from first principles
2. **Transformer expressivity** — what can/can't transformers compute?
3. **In-context learning** — mechanistic understanding
4. **Emergence prediction** — when do capabilities appear?
5. **Implicit regularization** — formal characterization for deep networks
6. **Interpretability foundations** — mathematical framework for circuits

## Finding Your Niche

1. Pick a gap where theory lags practice significantly
2. Start with a specific phenomenon (e.g., grokking)
3. Read both theory papers AND empirical ones on the topic
4. Look for simplifying assumptions that make analysis tractable
5. Validate theoretical predictions with experiments
