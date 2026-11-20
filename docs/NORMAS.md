# Normas que guiam o fluxo de restauração

O fluxo do Restaura segue princípios de quatro famílias de normas. Nenhuma delas é uma norma única de "restauração digital de fotos": o fluxo junta o que cada uma exige. Onde o texto oficial é pago ou não foi lido na íntegra, isso está dito.

## 1. Qualidade de imagem medida, não opinada

- **FADGI, Technical Guidelines for Digitizing Cultural Heritage Materials (3ª edição, 2023)**: avalia a imagem por critérios medidos (tom, cor, resolução) em quatro níveis, de 1 a 4 estrelas.
- **ISO 19264-1:2021** e **Metamorfoze**: mesmo princípio; a Metamorfoze resume o objetivo como "toda informação visível no original precisa estar visível na imagem digital". O texto da ISO é pago e não foi lido; vale aqui só o princípio.

No fluxo: o sistema mede nitidez, ruído, contraste, saturação e exposição na entrada e de novo no fim; o laudo mostra antes e depois. As tolerâncias numéricas dessas normas valem para digitalização com cartela de teste e não se aplicam a uma foto já danificada, então o Restaura usa as medidas para comparar, não para dar estrelas.

## 2. Ética de conservação e restauro

- **Carta de Veneza (1964), art. 9**: a restauração "termina onde começa a hipótese" (conjectura).
- **Carta de Veneza, art. 12**: o que substitui uma parte faltante deve se integrar ao conjunto e, ao mesmo tempo, distinguir-se do original, para não falsear o documento.
- **Códigos de ética de conservação (AIC, Icon, AICCM)**: examinar e documentar antes de tratar; intervir o mínimo necessário; a intervenção deve ser detectável e, quanto possível, reversível; documentar o tratamento. O texto da diretriz do AIC sobre compensação de perdas não foi lido na íntegra.

No fluxo:
- exame e laudo de estado antes de qualquer correção (analista);
- plano de tratamento por parte, do menos invasivo para o mais invasivo (conservador);
- parte faltante só é recriada com base em evidência (referência no mapa). Sem referência, a opção gerada é marcada como **conjectura** e o revisor e o usuário veem esse aviso;
- toda escolha vira uma versão e pode ser desfeita (reversível);
- o laudo lista o que é original, o que foi corrigido por filtro e o que foi recriado.

## 3. Processamento de imagem documentado e repetível

- **SWGDE Image Processing Guidelines (2016)**: o original é preservado e o processamento é feito numa cópia de trabalho; os passos são registrados para que outra pessoa treinada consiga repeti-los; realce exagerado cria artefatos que acrescentam informação enganosa.

No fluxo: o arquivo original nunca é alterado; cada opção guarda o filtro, a intensidade ou o pedido usado; a linha do tempo e o laudo registram quem fez o quê; o revisor reprova halos, textura inventada e emendas.

## 4. Marcação de conteúdo gerado por IA

- **IPTC Digital Source Type**: `compositeWithTrainedAlgorithmicMedia` para imagem que mistura captura com partes geradas por IA (inpainting); `algorithmicallyEnhanced` para imagem só alterada por algoritmo.
- **C2PA (Content Credentials)**: usa o mesmo vocabulário do IPTC. O Restaura não assina credenciais C2PA; grava só o metadado XMP do IPTC.

No fluxo: o arquivo baixado leva o metadado XMP com o tipo de fonte digital correto.

## Ordem das operações

Guias de prática de restauração digital (não são normas) concordam na ordem: corrigir tom e cor primeiro, depois ruído, depois recompor o que falta, e nitidez por último. O conservador numera as partes nessa ordem.

## O fluxo resultante

1. **Original preservado**: cópia de trabalho; medição de entrada.
2. **Exame** (analista): laudo de estado e partes com problema.
3. **Evidências** (cartógrafo): pedidos de referência e mapa.
4. **Plano de tratamento** (conservador): tratamento e ordem de cada parte, intervenção mínima.
5. **Tratamento**: filtros locais (restaurador) e reintegração de perdas (gerador Canva).
6. **Controle de qualidade** (revisor): fidelidade, artefatos, emendas, conjectura; plano de ajuste quando reprova.
7. **Escolha** (usuário): reversível, uma versão por escolha.
8. **Inspeção final** (inspetor): imagem inteira contra o original, medidas antes e depois.
9. **Laudo e procedência**: laudo de restauração e metadado de fonte digital no arquivo.

## Fontes

- FADGI: https://www.digitizationguidelines.gov/guidelines/digitize-technical.html
- ISO 19264-1:2021: https://www.iso.org/standard/79172.html
- Metamorfoze e FADGI comparadas: https://heritage-digitaltransitions.com/digitization-program-planning/overview-of-fadgi-metamorfoze-guidelines/
- Carta de Veneza: https://en.wikipedia.org/wiki/Venice_Charter
- AIC, Code of Ethics and Guidelines for Practice: https://www.culturalheritage.org/docs/default-source/administration/governance/code-of-ethics-and-guidelines-for-practice.pdf
- SWGDE Image Processing Guidelines: https://www.swgde.org/documents/published-complete-listing/15-m-002-swgde-image-processing-guidelines/
- IPTC, termo para inpainting com IA: https://iptc.org/news/new-digital-source-type-term-added-to-support-inpainting-outpainting-in-generative-ai/
- IPTC, guia para mídia gerada por IA: https://iptc.org/news/iptc-publishes-metadata-guidance-for-ai-generated-synthetic-media/
