import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { RAIZ } from '../../lib/rotas';
import type { ProjetoResumo } from '../../lib/tipos';
import { useDados } from '../../lib/useDados';
import { Aviso, Botao, Carregando, Pagina } from '../../ui';
import { PainelFluxo } from './PainelFluxo';
import './fluxo.css';

// montarFluxo mora em PainelFluxo.tsx (junto da tela que a usa); reexportada aqui.
export { montarFluxo } from './PainelFluxo';

// Projeto pedido na URL; sem pedido válido, o primeiro com trabalho ativo, senão o mais recente.
function escolherProjeto(projetos: ProjetoResumo[], pedido: string | null): ProjetoResumo | null {
  if (projetos.length === 0) return null;
  const id = Number(pedido);
  if (pedido !== null && Number.isInteger(id)) {
    const achado = projetos.find((p) => p.id === id);
    if (achado) return achado;
  }
  const trabalhando = projetos.find((p) => p.trabalhosAtivos > 0);
  if (trabalhando) return trabalhando;
  return [...projetos].sort((a, b) => Date.parse(b.criadoEm) - Date.parse(a.criadoEm))[0];
}

export function Fluxo() {
  const [params, setParams] = useSearchParams();
  const [demonstracao, setDemonstracao] = useState<boolean>(false);
  const lista = useDados<ProjetoResumo[]>('/projetos');
  const projetos = useMemo(() => lista.dados ?? [], [lista.dados]);
  const escolhido = useMemo(() => escolherProjeto(projetos, params.get('projeto')), [projetos, params]);

  const acoes = (
    <Botao variante="secundario" aoClicar={() => setDemonstracao((d) => !d)}>
      {demonstracao ? 'Parar demonstração' : 'Ver demonstração'}
    </Botao>
  );

  if (demonstracao) {
    return (
      <Pagina titulo="Fluxo ao vivo" acoes={acoes}>
        <Aviso tipo="info">Demonstração com dados de exemplo. Nada é gravado.</Aviso>
        <PainelFluxo key="demonstracao" projetoId={0} demonstracao />
      </Pagina>
    );
  }

  return (
    <Pagina titulo="Fluxo ao vivo" acoes={acoes}>
      {lista.erro && <Aviso tipo="erro">{lista.erro}</Aviso>}
      {lista.dados === null && !lista.erro && <Carregando />}

      {lista.dados !== null && escolhido === null && (
        <Aviso tipo="info">
          Envie uma imagem em <Link to={`${RAIZ}/projetos`}>Imagens</Link> para ver a equipe trabalhar.
        </Aviso>
      )}

      {escolhido !== null && (
        <>
          <div className="fluxo-seletor">
            <label htmlFor="fluxo-projeto">Imagem</label>
            <select
              id="fluxo-projeto"
              value={escolhido.id}
              onChange={(e) => setParams({ projeto: e.target.value })}
            >
              {projetos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                  {p.trabalhosAtivos > 0 ? ' • trabalhando' : ''}
                </option>
              ))}
            </select>
          </div>
          <PainelFluxo key={escolhido.id} projetoId={escolhido.id} />
        </>
      )}
    </Pagina>
  );
}
