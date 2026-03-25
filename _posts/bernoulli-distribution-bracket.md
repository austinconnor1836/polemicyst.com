---
title: "If You Feel Bad About Your Bracket, Here's the Bernoulli Distribution"
excerpt: 'Your March Madness bracket is busted. Before you blame yourself, blame the math. The Bernoulli distribution reveals why a perfect bracket is virtually impossible — and why you should feel great about getting even half the games right.'
coverImage: '/assets/blog/bernoulli-distribution/cover.jpg'
date: '2026-03-20T12:00:00.000Z'
author:
  name: Polemicyst
  picture: '/assets/blog/authors/me.png'
ogImage:
  url: '/assets/blog/bernoulli-distribution/cover.jpg'
---

It's March. Your bracket is in shambles. That 12-seed upset you swore wouldn't happen did happen, your championship pick lost in the second round, and your coworker who picked teams based on mascot cuteness is somehow beating you. Before you spiral into existential doubt about your basketball knowledge, let me introduce you to an 18th-century Swiss mathematician who can explain exactly why this was always going to happen.

## Jacob Bernoulli and your busted bracket

Jacob Bernoulli published _Ars Conjectandi_ in 1713, and in it he formalized something deceptively simple: any event that has exactly two outcomes — success or failure, heads or tails, correct pick or wrong pick — follows what we now call the **Bernoulli distribution**.

Every game in your bracket is a Bernoulli trial. You either pick it right (success, with some probability _p_) or you pick it wrong (failure, with probability _1 − p_). That's it. No partial credit. No "well, I had the right team but the wrong round." Binary. Merciless.

Formally, if _X_ is a random variable representing a single game prediction:

<blockquote style="background: rgba(128,128,128,0.08); border-left: 4px solid #666; padding: 1em 1.2em; border-radius: 4px; font-family: Georgia, serif;">
<strong>P(X = 1) = p</strong>&nbsp;&nbsp;&nbsp;(you pick correctly)<br/>
<strong>P(X = 0) = 1 − p</strong>&nbsp;&nbsp;&nbsp;(you pick incorrectly)
</blockquote>

That's the entire Bernoulli distribution. It's the simplest probability distribution that exists. And it's about to ruin your day.

## 63 coin flips

The NCAA tournament bracket has 63 games (ignoring the First Four play-in games). If you're picking completely at random — flipping a coin for every game — each pick has _p_ = 0.5. The probability of getting every single game right is:

<blockquote style="background: rgba(128,128,128,0.08); border-left: 4px solid #666; padding: 1em 1.2em; border-radius: 4px; font-family: Georgia, serif;">
<strong>P(perfect bracket) = 0.5<sup>63</sup> = 1 in 9,223,372,036,854,775,808</strong>
</blockquote>

That's 1 in 9.2 **quintillion**. To put that in perspective:

- There are roughly 7.5 quintillion grains of sand on Earth. Your odds of a perfect random bracket are worse than picking one specific grain of sand out of every beach, desert, and ocean floor on the planet.
- If every person who has ever lived (about 117 billion humans) each filled out one bracket per second since the Big Bang (13.8 billion years ago), the total number of brackets attempted would still be about 50 million times _fewer_ than the number needed to expect a single perfect one.

## "But I know basketball"

Fair enough. You're not flipping coins. You watch games, you follow the analytics, you know that a 1-seed has historically beaten a 16-seed about 99% of the time. Let's be generous and say you're a genuine expert who picks each game correctly with probability _p_ = 0.67 — two-thirds of the time, better than almost any analyst.

Now when we chain 63 independent Bernoulli trials together, each with _p_ = 0.67, we get a sum that follows the **Binomial distribution**. The probability that you get all 63 right:

<blockquote style="background: rgba(128,128,128,0.08); border-left: 4px solid #666; padding: 1em 1.2em; border-radius: 4px; font-family: Georgia, serif;">
<strong>P(perfect bracket) = 0.67<sup>63</sup> ≈ 1 in 602,000,000,000</strong>
</blockquote>

One in 602 billion. Your odds improved by a factor of about 15 billion compared to coin flipping, which sounds impressive until you realize you went from "absolutely impossible" to "still absolutely impossible."

Even at _p_ = 0.75 — an unrealistically high accuracy that no human forecaster sustains over a full tournament — the probability is still roughly 1 in 2.2 billion.

## What you should actually expect

Here's where the Bernoulli distribution offers some consolation. When you sum up 63 Bernoulli trials, each with success probability _p_, the expected number of correct picks is:

<blockquote style="background: rgba(128,128,128,0.08); border-left: 4px solid #666; padding: 1em 1.2em; border-radius: 4px; font-family: Georgia, serif;">
<strong>E[correct picks] = n × p = 63 × p</strong>
</blockquote>

| Your skill level     | Probability per game (_p_) | Expected correct picks | Expected wrong picks |
| -------------------- | -------------------------- | ---------------------- | -------------------- |
| Pure coin flip       | 0.50                       | 31.5                   | 31.5                 |
| Casual fan           | 0.60                       | 37.8                   | 25.2                 |
| Knowledgeable fan    | 0.67                       | 42.2                   | 20.8                 |
| Expert analyst       | 0.72                       | 45.4                   | 17.6                 |
| Unrealistically good | 0.80                       | 50.4                   | 12.6                 |

So if you're a reasonably knowledgeable basketball fan, you should _expect_ to get around 42 games right and 21 games wrong. Getting 21 games wrong isn't a failure — it's the mathematical expectation. It's what _should_ happen.

The standard deviation of a Binomial distribution is √(n × p × (1−p)), which for our knowledgeable fan is √(63 × 0.67 × 0.33) ≈ 3.7. So roughly 68% of the time, you'll get between 38 and 46 games right. All of those outcomes are perfectly normal.

## Why upsets destroy brackets

The real mathematical cruelty of March Madness isn't the Bernoulli distribution alone — it's the **cascade effect**. In a single-elimination tournament, getting one game wrong doesn't just cost you that game. It eliminates a team from your bracket entirely, potentially costing you several downstream picks.

Pick the wrong team in the first round? That's one wrong pick. But if you had that team advancing to the Sweet 16, that's now _three_ wrong picks from a single upset. Had them in your Final Four? Now one upset just destroyed five of your picks. This cascade means the effective _p_ for later-round picks is lower than your raw game-prediction accuracy, because your later picks are conditional on your earlier picks being correct.

This is why brackets tend to collapse in waves. One upset isn't just one wrong answer — it's a chain reaction through the entire structure.

## The consolation of Bernoulli

Here's the thing Jacob Bernoulli figured out over 300 years ago that should make you feel better: in any sequence of independent binary outcomes with fixed probability, the results will **converge to the expected value** over a large number of trials. This is the Law of Large Numbers, and it's the philosophical punchline of the Bernoulli distribution.

You are not failing at your bracket. You are _converging to your expected value_. The mathematics guarantee that no matter how skilled you are, you will get a substantial number of games wrong. A perfect bracket isn't a test of basketball knowledge — it's a test of absurd, lottery-defying luck.

So the next time someone asks why your bracket is busted, tell them: "It's not busted. It's behaving exactly as the Bernoulli distribution predicts." Then watch their eyes glaze over while you quietly feel better about the whole thing.

## The real lesson

March Madness pools aren't won by people who get every game right. They're won by people who get _slightly more_ games right than the competition, particularly in the later rounds where points are weighted more heavily. The Bernoulli distribution tells you that the difference between the winner of your office pool and the person in last place is often just 5-8 correct picks out of 63 — a variance well within the normal statistical range.

In other words, the winner of your pool probably isn't a basketball genius. They just happened to land on the right side of the distribution this time. And so, perhaps, next year will be your turn.

Bernoulli would have liked those odds.
