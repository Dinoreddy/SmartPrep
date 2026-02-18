/**
 * Elo Rating Calculator
 *
 * Standard Elo formula: P = 1 / (1 + 10^((Opponent - You) / 400))
 *
 * K-Factor rules:
 *   User     — Asymmetric: K=32 on win (fast climb), K=16 on loss (soft landing)
 *   Question — Symmetric:  K=20 always (gains when user loses, loses when user wins)
 */

const MIN_ELO = 100; // Floor to prevent negative ratings

/**
 * @param {number} userElo       - Current user Elo for the topic
 * @param {number} questionElo   - Current question Elo rating
 * @param {boolean} isCorrect    - Whether the user answered correctly
 * @returns {{ newUserElo: number, newQuestionElo: number, eloChange: number }}
 */
export function calculateElo(userElo, questionElo, isCorrect) {
  // Expected probability that the user answers correctly
  const expectedUser = 1 / (1 + Math.pow(10, (questionElo - userElo) / 400));

  // Actual score: 1 = win, 0 = loss
  const actualScore = isCorrect ? 1 : 0;

  // Asymmetric K for user
  const userK = isCorrect ? 32 : 16;

  // Symmetric K for question
  const questionK = 20;

  const rawUserChange = userK * (actualScore - expectedUser);
  const eloChange = Math.round(rawUserChange);

  const newUserElo = Math.max(MIN_ELO, Math.round(userElo + rawUserChange));

  // Question moves in the opposite direction: it "wins" when user loses
  const questionActual = isCorrect ? 0 : 1; // inverse of user result
  const expectedQuestion = 1 - expectedUser;
  const newQuestionElo = Math.max(
    MIN_ELO,
    Math.round(questionElo + questionK * (questionActual - expectedQuestion)),
  );

  return { newUserElo, newQuestionElo, eloChange };
}
