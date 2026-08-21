function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendPasswordResetEmail({ email, resetUrl }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PASSWORD_RESET_FROM;
  if (!apiKey || !from) return { delivered: false, reason: 'not-configured' };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Reset your Provista password',
      html: `<p>Use the link below to reset your Provista password. It expires in 30 minutes.</p>
        <p><a href="${escapeHtml(resetUrl)}">Reset password</a></p>
        <p>If you did not request this, you can ignore this email.</p>`
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Password reset email failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
  }
  return { delivered: true };
}

module.exports = { sendPasswordResetEmail };
