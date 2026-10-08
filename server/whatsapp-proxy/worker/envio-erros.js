// Classifica o erro de um envio à Evolution API: a mensagem pode ter sido entregue mesmo assim?
//
// Revisão técnica 08/10/2026 (docs/code-review/REVIEW.md, #11). O worker repetia o envio até 3
// vezes em QUALQUER erro. Se a Evolution enviou a mensagem mas a resposta demorou mais que o
// timeout (ou a conexão caiu depois do envio), a repetição entregava a mesma mensagem de novo
// ao destinatário. Aqui só é "ambíguo" o que acontece DEPOIS de o pedido sair: timeout de
// resposta e conexão cortada. Recusa explícita da Evolution (HTTP não-2xx, como "Connection
// Closed") e falha ao conectar (nada foi enviado) continuam podendo ser repetidas.
const CODIGOS_AMBIGUOS = new Set(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ESOCKETTIMEDOUT', 'UND_ERR_SOCKET']);

function envioPodeTerChegado(err) {
  if (!err) return false;
  if (err.type === 'request-timeout' || err.type === 'body-timeout') return true; // node-fetch v2
  if (CODIGOS_AMBIGUOS.has(err.code) || CODIGOS_AMBIGUOS.has(err.errno)) return true;
  const msg = String(err.message || '').toLowerCase();
  return msg.includes('network timeout') || msg.includes('socket hang up') || msg.includes('premature close');
}

module.exports = { envioPodeTerChegado };
