// Nightforge landing page — minimal JS
// Terminal typing animation + smooth scroll + Stripe checkout redirect

document.addEventListener("DOMContentLoaded", () => {
  // Animate terminal lines on scroll into view
  const terminal = document.querySelector(".terminal-body");
  if (terminal) {
    const lines = terminal.querySelectorAll(".line");
    lines.forEach((line, i) => {
      line.style.opacity = "0";
      line.style.transform = "translateX(-10px)";
      line.style.transition = `all 0.3s ease ${i * 0.15}s`;
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            lines.forEach((line) => {
              line.style.opacity = "1";
              line.style.transform = "translateX(0)";
            });
            observer.disconnect();
          }
        });
      },
      { threshold: 0.3 }
    );
    observer.observe(terminal);
  }

  // Feature cards stagger animation
  const cards = document.querySelectorAll(".feature-card");
  const cardObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = "1";
          entry.target.style.transform = "translateY(0)";
        }
      });
    },
    { threshold: 0.1 }
  );

  cards.forEach((card, i) => {
    card.style.opacity = "0";
    card.style.transform = "translateY(20px)";
    card.style.transition = `all 0.4s ease ${i * 0.1}s`;
    cardObserver.observe(card);
  });

  // Pricing button click → Stripe checkout (placeholder URLs)
  // Replace these with real Stripe Payment Link URLs after setup
  const STRIPE_LINKS = {
    solo: "https://buy.stripe.com/test_eVq3cxb2iabb0tQ3aw6Ri00",
    squad: "https://buy.stripe.com/test_28E9AVgmC6YZdgCaCY6Ri01",
    empire: "https://buy.stripe.com/test_dRm00l5HYfvv6SebH26Ri02",
  };

  document.querySelectorAll("[data-tier]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const tier = btn.dataset.tier;
      if (!tier) return;
      const link = STRIPE_LINKS[tier];
      if (link && !link.startsWith("#stripe-")) {
        window.location.href = link;
      } else {
        // Placeholder: scroll to contact or show coming soon
        alert(
          `${tier.charAt(0).toUpperCase() + tier.slice(1)} tier — Stripe checkout coming soon.\n\nEmail hello@getnightforge.com for early access.`
        );
      }
    });
  });

  // Nav background on scroll
  const nav = document.querySelector(".nav");
  window.addEventListener("scroll", () => {
    if (window.scrollY > 50) {
      nav?.classList.add("scrolled");
    } else {
      nav?.classList.remove("scrolled");
    }
  });
});
