/**
 * Sintaxe de e-mail aceita pelo site (lista de PERMITIDOS, igual no navegador e no servidor):
 * parte local com letras, números e `. _ + -` (1 a 64, sem ponto no início, no fim ou duplo); domínio com rótulos de letras, números e hífen
 * (sem hífen nas pontas) e final de 2+ letras; no máximo 254 caracteres. Isso também impede parâmetros injetados em links mailto: (? & = , ; < > " % \\ espaço).
 */
export const SAFE_EMAIL_RE = /^(?=.{3,254}$)(?!\.)(?![^@]*\.\.)(?![^@]*\.@)[A-Za-z0-9._+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
