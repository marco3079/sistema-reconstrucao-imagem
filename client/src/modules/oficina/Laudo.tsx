import { Fragment, useState } from 'react';
import { api } from '../../lib/api';
import { CATEGORIAS, ROTULO_CATEGORIA, ROTULO_PROBLEMA } from '../../lib/tipos';
import type { Laudo as DadosDoLaudo, TratamentoDaParte } from '../../lib/tipos';
import { Aviso, Botao, Carregando, Selo, formatarDataHora } from '../../ui';

// Linhas da tabela de medidas: a qualidade geral vem de campos próprios; as demais, de Metricas.
const MEDIDAS: { rotulo: string; chave: 'nitidez' | 'ruido' | 'contraste' | 'saturacao' | 'exposicao' }[] = [
  { rotulo: 'Nitidez', chave: 'nitidez' },
  { rotulo: 'Ruído', chave: 'ruido' },
  { rotulo: 'Contraste', chave: 'contraste' },
  { rotulo: 'Saturação', chave: 'saturacao' },
  { rotulo: 'Exposição', chave: 'exposicao' },
];

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : 'Erro inesperado';
}

// Marca o body só durante a impressão: o CSS esconde as outras telas e mostra só o laudo.
function imprimir() {
  document.body.classList.add('imprimindo-laudo');
  window.addEventListener('afterprint', () => document.body.classList.remove('imprimindo-laudo'), { once: true });
  window.print();
}

function numero(valor: number): string {
  return valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

function diferenca(antes: number, depois: number): string {
  const d = depois - antes;
  return `${d > 0 ? '+' : ''}${numero(d)}`;
}

function textoTratamento(dados: TratamentoDaParte): string {
  return `${dados.rotulo} (${dados.origem === 'LOCAL' ? 'filtro local' : 'recriado no Canva'})`;
}

export function Laudo({ projetoId }: { projetoId: number }) {
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState<DadosDoLaudo | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function buscar() {
    setAberto(true);
    setCarregando(true);
    setErro(null);
    try {
      const resposta = await api.get<DadosDoLaudo>(`/projetos/${projetoId}/laudo`);
      setDados(resposta);
    } catch (e) {
      setErro(mensagem(e));
    } finally {
      setCarregando(false);
    }
  }

  if (!aberto) {
    return (
      <Botao variante="secundario" aoClicar={buscar}>
        Ver laudo de restauração
      </Botao>
    );
  }

  return (
    <>
      <div className="rec-acoes-resultado">
        <Botao variante="secundario" aoClicar={imprimir}>
          Imprimir laudo
        </Botao>
        <Botao variante="secundario" desabilitado={carregando} aoClicar={buscar}>
          Atualizar
        </Botao>
      </div>

      {carregando && !dados && <Carregando />}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      {dados && (
        <article className="rec-laudo">
          <header>
            <h2>Laudo de restauração</h2>
            <p>{dados.projeto.nome}</p>
            <p className="rec-texto-pequeno">
              {`Tamanho: ${dados.projeto.largura} × ${dados.projeto.altura} px`}
            </p>
            <p className="rec-texto-pequeno">{`Gerado em ${formatarDataHora(dados.geradoEm)}`}</p>
          </header>

          {dados.conteudoGerado && (
            <Aviso tipo="info">
              Esta imagem tem partes recriadas por IA. O arquivo baixado leva essa marcação (IPTC Digital Source Type).
            </Aviso>
          )}
          {dados.conjecturas > 0 && (
            <Aviso tipo="info">
              {dados.conjecturas === 1
                ? '1 parte recriada sem referência: é conjectura, não recuperação.'
                : `${dados.conjecturas} partes recriadas sem referência: é conjectura, não recuperação.`}
            </Aviso>
          )}

          <section>
            <h3>Estado inicial</h3>
            {dados.descricao && <p>{dados.descricao}</p>}
            {dados.problemas.length > 0 && (
              <ul className="oficina-lista">
                {dados.problemas.map((p, i) => (
                  <li key={`${p.codigo}-${i}`}>
                    <strong>{ROTULO_PROBLEMA[p.codigo]}</strong> <Selo cor="amarelo">{`gravidade ${p.gravidade}/5`}</Selo>
                    <p>{p.descricao}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3>Medidas antes e depois</h3>
            <div className="rec-laudo-tabela-area">
              <table className="rec-laudo-tabela">
                <thead>
                  <tr>
                    <th scope="col">Medida</th>
                    <th scope="col">Antes</th>
                    <th scope="col">Depois</th>
                    <th scope="col">Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Qualidade geral</th>
                    <td>{numero(dados.medidas.qualidadeAntes)}</td>
                    <td>{numero(dados.medidas.qualidadeDepois)}</td>
                    <td>{diferenca(dados.medidas.qualidadeAntes, dados.medidas.qualidadeDepois)}</td>
                  </tr>
                  {MEDIDAS.map((m) => (
                    <tr key={m.chave}>
                      <th scope="row">{m.rotulo}</th>
                      <td>{numero(dados.medidas.antes[m.chave])}</td>
                      <td>{numero(dados.medidas.depois[m.chave])}</td>
                      <td>{diferenca(dados.medidas.antes[m.chave], dados.medidas.depois[m.chave])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="rec-texto-pequeno">Ruído: quanto menor, melhor. Exposição: o ideal é 50.</p>
          </section>

          <section>
            <h3>Partes tratadas</h3>
            <p>A foto foi separada em partes e cada uma foi tratada no lugar dela, sem mudar a posição de nada.</p>
            <div className="rec-laudo-tabela-area">
              <table className="rec-laudo-tabela">
                <thead>
                  <tr>
                    <th scope="col">Parte</th>
                    <th scope="col">O que é</th>
                    <th scope="col">Problema</th>
                    <th scope="col">Plano</th>
                    <th scope="col">Referências</th>
                    <th scope="col">Tratamento</th>
                    <th scope="col">Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {CATEGORIAS.map((c) => {
                    const partesDaCategoria = dados.partes.filter((p) => p.categoria === c);
                    if (partesDaCategoria.length === 0) return null;
                    return (
                      <Fragment key={c}>
                        <tr className="oficina-laudo-grupo">
                          <th colSpan={7} scope="colgroup">
                            {ROTULO_CATEGORIA[c]}
                          </th>
                        </tr>
                        {partesDaCategoria.map((p) => (
                          <tr key={p.id}>
                            <th scope="row">{p.nome}</th>
                            <td>{ROTULO_CATEGORIA[p.categoria]}</td>
                            <td>{p.problema === 'NENHUM' ? 'Sem problema' : ROTULO_PROBLEMA[p.problema]}</td>
                            <td>{p.plano || '—'}</td>
                            <td>{p.referencias}</td>
                            <td>
                              {p.tratamento === null ? (
                                'Sem tratamento escolhido'
                              ) : (
                                <>
                                  {textoTratamento(p.tratamento)}{' '}
                                  {p.tratamento.conjectura && <Selo cor="amarelo">Conjectura</Selo>}
                                </>
                              )}
                            </td>
                            <td>{p.tratamento && p.tratamento.nota !== null ? `${p.tratamento.nota}/10` : '—'}</td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3>Versões</h3>
            <ul className="oficina-lista">
              {dados.versoes.map((v) => (
                <li key={v.numero}>
                  <strong>{`Versão ${v.numero}`}</strong> <span className="rec-texto-pequeno">{formatarDataHora(v.criadoEm)}</span>
                  {v.descricao && <p>{v.descricao}</p>}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>Princípios seguidos</h3>
            <ul className="oficina-lista">
              {dados.principios.map((pr, i) => (
                <li key={`${pr.titulo}-${i}`}>
                  <strong>{pr.titulo}</strong>
                  <p>
                    {pr.texto} <span className="rec-suave">({pr.norma})</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>

          {dados.fonteDigital !== null && (
            <footer>
              <p className="rec-texto-pequeno">{`Fonte digital gravada no arquivo: ${dados.fonteDigital}`}</p>
            </footer>
          )}
        </article>
      )}
    </>
  );
}
