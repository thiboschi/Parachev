import { Document, Image, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer"

// Embarqué dans le module (data URI) : le rendu du PDF n'a rien à télécharger.
import logoArcelorMittal from "@/assets/logo_arcelormittal.png?inline"
import type { ChampNorme } from "@/lib/recherche"

// Offre de prix générée depuis la page "Chiffrage" : tout ce qui y est saisi
// et chiffré, mis en page pour être envoyé au client. Ce module embarque
// @react-pdf/renderer : il est chargé à la demande (import dynamique).

export interface LigneInfo {
  label: string
  valeur: string
}

/** Une norme renseignée dans la section "Normes et Exigences". */
export interface NormeOffre {
  key: ChampNorme
  valeur: string
}

export interface OperationOffre {
  libelle: string
  heures: number
  /** Quantités totales du projet pour cette opération. */
  quantites: LigneInfo[]
}

/** Un groupe de barres identiques : une ligne du tableau "Objet de l'offre". */
export interface BarresOffre {
  nombre: number
  profil: string
  /** Par barre, en mm ; null si non renseignée. */
  longueur: number | null
  /** Par barre, en t ; null si non renseigné. */
  poids: number | null
  /** Quantités saisies pour ce groupe dans les modules de ses postes, dans
   *  l'ordre de la gamme. */
  operations: string[]
}

export interface SoudureOffre {
  designation: string
  nombre: string
  longueur: string
  preparation: string
  passes: string
}

export interface DonneesOffre {
  date: Date
  client: string
  commercial: string
  numeroOffre: string
  /** Résumé de la prestation, ex. "Parachèvement de poutrelles HD – EXC3". */
  objet: string
  typeAffaire: string
  barres: BarresOffre[]
  normes: NormeOffre[]
  operations: OperationOffre[]
  /** Pièces à souder sur une barre (calculateur de soudage). */
  soudures: SoudureOffre[]
  totalHeures: number
  /** Suppléments d'heures des majorations appliquées au total (DBS,
   *  tolérance classe 2). */
  majorations: { label: string; heures: number }[]
  /** Taux horaire (€/h) et montant, null si non renseigné. */
  tauxHoraire: number | null
  montant: number | null
  /** Montant rapporté au poids total des barres (€/t), null sans montant
   *  ou sans poids renseigné. */
  prixTonne: number | null
}

// Signataire de l'offre, affiché dans l'en-tête.
const AUTEUR = "Damien Schils"

// Phrase d'introduction de la première page, au-dessus du trait de l'en-tête.
const ACCROCHE =
  "Nous vous remercions pour votre demande et l'intérêt porté à nos services.\nSur la base des éléments transmis, nous avons le plaisir de vous présenter notre proposition"

// Normes rédigées, dans l'ordre de l'offre : le début de la phrase, que
// termine la valeur choisie.
const PHRASES_NORMES: { key: ChampNorme; phrase: string }[] = [
  { key: "exc", phrase: "Fabrication suivant EN 1090-2:2018, classe d'exécution" },
  { key: "tolerance", phrase: "Tolérances géométriques selon EN 1090-2 :" },
  { key: "prep", phrase: "Degré de préparation selon EN ISO 8501-3 :" },
  { key: "classeUs", phrase: "Contrôle par ultrasons :" },
  { key: "en10204", phrase: "Document de contrôle :" },
  { key: "en10163", phrase: "Exigences de réparation :" },
  { key: "exigencesFabrication", phrase: "Exigences particulières de fabrication :" },
  { key: "exigencesAcier", phrase: "Exigences particulières acier :" },
]

const TRACABILITE =
  "Traçabilité des produits constitutifs garantie jusqu'à l'assemblage, sous forme de lots (plusieurs documents de contrôle possibles par repère)."

// Textes de l'annexe, les mêmes pour toutes les offres.
const LISTES_ANNEXE: { titre: string; lignes: string[] }[] = [
  {
    titre: "À votre charge",
    lignes: [
      "Fourniture des profils, avec une surlongueur suffisante",
      "Stockage intermédiaire et acheminement des profils jusqu'à notre atelier, à notre demande, au fur et à mesure de l'avancement de l'affaire",
      "Fourniture des plans d'exécution BPE au format DWG (traçage des plans d'assemblage et des plans de débit) et des fichiers DSTV, le tout sur barre droite",
      "Fourniture des nomenclatures associées (expédition, assemblage et débit)",
      "Traitements de surface",
      "Transports",
    ],
  },
  {
    titre: "Non compris dans notre offre",
    lignes: [
      "Fourniture de la boulonnerie",
      "Fourniture des tôles de calage",
      "Fourniture des platines d'ancrage",
      "Toute prestation non mentionnée dans la présente offre",
    ],
  },
]

const CONDITIONS: LigneInfo[] = [
  {
    label: "Délais",
    valeur:
      "Les délais de fabrication pourront vous être communiqués par Victor / Mario, en fonction de vos besoins et du planning de production en cours.",
  },
  {
    label: "Validité de l'offre",
    valeur:
      "Le prix matière des tôles ne peut être garanti, en raison des fluctuations de leur prix d'achat. Toute augmentation sera répercutée à la date de réception de la commande. Le prix de la main-d'œuvre est valable 3 mois.",
  },
  { label: "Prix", valeur: "Tous nos prix s'entendent hors taxes (H.T.)." },
  {
    label: "Remarques",
    valeur:
      "Toute modification ou tout ajout par rapport aux clauses de notre devis donnera lieu à un recalcul de notre prix et à une révision de notre offre. Si, pour des raisons esthétiques, les poutres nécessitent une finition ou un soin particulier, nous vous prions de nous consulter afin que nous adaptions notre prix.",
  },
  { label: "Conditions de paiement", valeur: "Paiement à 30 jours fin de mois." },
]

// Derniers paragraphes de l'annexe, avant la formule de politesse.
const CLOTURE = [
  "Si cette proposition ne correspond pas entièrement à vos attentes, nous vous invitons à nous en informer. Nous pourrons alors analyser une alternative technique ou commerciale afin de vous proposer la solution la plus adaptée.",
  "Pour toute question ou précision supplémentaire, nous restons à votre entière disposition.",
]

const MARINE = "#1e3a5f"
const GRIS = "#64748b"
const TRAIT = "#e2e8f0"
const FOND = "#f4f6f8"

// Les polices standard du PDF n'ont pas l'espace fine insécable que
// toLocaleString utilise comme séparateur de milliers : elle y sort en "/".
// Vaut aussi pour les textes composés sur la page "Chiffrage".
const sansEspaceFine = (texte: string) => texte.replace(/[\u202f\u00a0]/g, " ")

const format = (value: number, decimales: number, minimum = 0) =>
  sansEspaceFine(value.toLocaleString("fr-BE", { minimumFractionDigits: minimum, maximumFractionDigits: decimales }))

const euros = (value: number) => `${format(value, 2, 2)} €`

// Poids d'une barre au kg près, tonnage d'une position à 10 kg près.
const poidsBarre = (tonnes: number) => format(tonnes, 3, 3)
const tonnage = (tonnes: number) => format(tonnes, 2, 2)

// Tonnage d'une position, null sans poids renseigné.
const tonnagePosition = ({ nombre, poids }: BarresOffre) => (poids !== null && nombre > 0 ? nombre * poids : null)

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: "#0f172a",
    lineHeight: 1.35,
  },
  entete: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  accroche: { marginTop: 12 },
  traitEntete: { marginTop: 14, marginBottom: 16, borderBottomWidth: 2, borderBottomColor: MARINE },
  // Mêmes proportions que l'image (309 × 138 px).
  logo: { width: 103, height: 46 },
  titre: { fontFamily: "Helvetica-Bold", fontSize: 16, lineHeight: 1.2, color: MARINE, textAlign: "right" },
  sousTitre: { color: GRIS, textAlign: "right", marginTop: 2 },
  references: { color: GRIS, fontSize: 8, textAlign: "right", marginTop: 2 },
  objet: { fontSize: 11, gap: 3 },
  bloc: { marginTop: 16, backgroundColor: FOND, borderRadius: 4, padding: 10 },
  etiquette: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    color: GRIS,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  section: { marginTop: 18 },
  titreSection: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10.5,
    color: MARINE,
    paddingBottom: 4,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: TRAIT,
  },
  ligneTableau: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: TRAIT,
  },
  enteteTableau: { backgroundColor: MARINE, borderBottomWidth: 0, borderRadius: 2 },
  totalTableau: { backgroundColor: FOND, borderBottomWidth: 0 },
  celluleEntete: { fontFamily: "Helvetica-Bold", fontSize: 8, color: "#ffffff" },
  droite: { textAlign: "right" },
  detail: { color: GRIS, fontSize: 8.5 },
  totaux: { marginTop: 10, marginLeft: "auto", width: "52%" },
  ligneTotal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, paddingHorizontal: 6 },
  gras: { fontFamily: "Helvetica-Bold" },
  montant: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
    padding: 8,
    backgroundColor: MARINE,
    borderRadius: 4,
  },
  texteMontant: { fontFamily: "Helvetica-Bold", fontSize: 12, color: "#ffffff" },
  // Même bandeau que le montant, en plus discret.
  sousTotal: { marginTop: 0, marginBottom: 3, paddingVertical: 4, paddingHorizontal: 6 },
  texteSousTotal: { fontSize: 9.5 },
  titreAnnexe: { fontFamily: "Helvetica-Bold", fontSize: 13, color: MARINE },
  puce: { flexDirection: "row", paddingHorizontal: 6, marginBottom: 3 },
  pucePoint: { width: 10, color: MARINE },
  libelleCondition: { width: "24%", paddingRight: 8, fontFamily: "Helvetica-Bold" },
  signature: { marginTop: 22 },
  paragraphe: { marginBottom: 2 },
  pied: { position: "absolute", bottom: 26, left: 40, fontSize: 8, color: GRIS },
})

// Conditions de l'offre, sur une nouvelle page : ce qui reste à la charge du
// client, ce qui n'est pas compris, les conditions des devis envoyés aux
// clients, puis la formule de politesse et la signature.
function Annexe() {
  return (
    <View break>
      <Text style={styles.titreAnnexe}>Annexe — Conditions de l'offre</Text>

      {LISTES_ANNEXE.map(({ titre, lignes }, i) => (
        <View key={titre} style={styles.section} wrap={false}>
          <Text style={styles.titreSection}>
            {i + 1}. {titre}
          </Text>
          {lignes.map((ligne) => (
            <View key={ligne} style={styles.puce}>
              <Text style={styles.pucePoint}>•</Text>
              <Text style={{ flex: 1 }}>{ligne}</Text>
            </View>
          ))}
        </View>
      ))}

      <View style={styles.section}>
        <Text style={styles.titreSection}>{LISTES_ANNEXE.length + 1}. Informations</Text>
        {CONDITIONS.map(({ label, valeur }) => (
          <View key={label} style={styles.ligneTableau} wrap={false}>
            <Text style={styles.libelleCondition}>{label}</Text>
            <Text style={{ flex: 1 }}>{valeur}</Text>
          </View>
        ))}
      </View>

      <View style={styles.signature} wrap={false}>
        {CLOTURE.map((paragraphe) => (
          <Text key={paragraphe} style={{ marginBottom: 8 }}>
            {paragraphe}
          </Text>
        ))}
        <Text>
          Dans l'attente de votre retour, nous vous prions d'agréer, Madame, Monsieur, l'expression de nos sentiments
          les meilleurs.
        </Text>
        <Text style={[styles.gras, { marginTop: 14 }]}>{AUTEUR}</Text>
      </View>
    </View>
  )
}

// Largeurs des colonnes du tableau des groupes de barres.
const COLONNES_BARRES = ["8%", "24%", "14%", "20%", "18%", "16%"]

// Largeurs des colonnes du tableau des opérations.
const COLONNES_OPERATIONS = ["30%", "70%"]

// Largeurs des colonnes du tableau des pièces à souder.
const COLONNES_SOUDURES = ["34%", "12%", "20%", "22%", "12%"]

function OffrePdf({ offre }: { offre: DonneesOffre }) {
  const date = offre.date.toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric" })
  // Les temps sont chiffrés au taux horaire : l'offre n'affiche pas d'heures.
  const prix = (temps: number) => (offre.tauxHoraire !== null ? euros(temps * offre.tauxHoraire) : "—")
  const normes = PHRASES_NORMES.flatMap(({ key, phrase }) => {
    const norme = offre.normes.find((n) => n.key === key)
    return norme ? [{ key, phrase, valeur: norme.valeur }] : []
  })
  const tonnages = offre.barres.map(tonnagePosition)
  const totalBarres = offre.barres.reduce((total, { nombre }) => total + (nombre > 0 ? nombre : 0), 0)
  const tonnageTotal = tonnages.reduce<number>((total, t) => total + (t ?? 0), 0)

  return (
    <Document title={`Offre ${offre.numeroOffre}`.trim()} author="Parachev">
      <Page size="A4" style={styles.page}>
        <View style={styles.entete} fixed>
          <Image src={logoArcelorMittal} style={styles.logo} />
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.titre}>OFFRE TECHNIQUE & COMMERCIALE</Text>
            <Text style={styles.sousTitre}>
              {AUTEUR} - {date}
            </Text>
            {offre.numeroOffre !== "" && (
              <Text style={styles.references}>
                N° d'offre : <Text style={styles.gras}>{offre.numeroOffre}</Text>
              </Text>
            )}
          </View>
        </View>
        {/* Entre l'en-tête et son trait, tous deux répétés : la phrase ne sort que sur la première page. */}
        <Text style={styles.accroche}>{ACCROCHE}</Text>
        <View style={styles.traitEntete} fixed />

        <View style={styles.objet}>
          <Text>
            Objet : <Text style={styles.gras}>{offre.objet}</Text>
          </Text>
          <Text>
            Client : <Text style={styles.gras}>{offre.client || "—"}</Text>
          </Text>
          {offre.commercial !== "" && (
            <Text>
              Commercial : <Text style={styles.gras}>{offre.commercial}</Text>
            </Text>
          )}
        </View>

        <View style={styles.bloc}>
          <Text style={styles.etiquette}>Normes et exigences</Text>
          {normes.map(({ key, phrase, valeur }) => (
            <Text key={key}>
              {phrase} <Text style={styles.gras}>{valeur}</Text>
            </Text>
          ))}
          <Text style={[styles.detail, normes.length > 0 ? { marginTop: 4 } : {}]}>{TRACABILITE}</Text>
        </View>

        {offre.barres.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.titreSection}>Objet de l'offre</Text>
            <Text style={[styles.paragraphe, { marginBottom: 6 }]}>
              Veuillez trouver ci-dessous nos meilleures conditions tarifaires.
            </Text>
            {offre.typeAffaire !== "" && (
              <Text style={{ marginBottom: 6 }}>
                Type d'affaire : <Text style={styles.gras}>{offre.typeAffaire}</Text>
              </Text>
            )}
            <View style={[styles.ligneTableau, styles.enteteTableau]} fixed>
              {["Pos.", "Profil", "Quantité", "Longueur (mm)", "Poids unit. (t)", "Tonnage (t)"].map((colonne, i) => (
                <Text key={colonne} style={[styles.celluleEntete, { width: COLONNES_BARRES[i] }, i >= 2 ? styles.droite : {}]}>
                  {colonne}
                </Text>
              ))}
            </View>
            {offre.barres.map((barres, i) => (
              <View key={i} style={styles.ligneTableau} wrap={false}>
                <Text style={{ width: COLONNES_BARRES[0] }}>{i + 1}</Text>
                <Text style={[styles.gras, { width: COLONNES_BARRES[1] }]}>{barres.profil || "—"}</Text>
                <Text style={[styles.droite, { width: COLONNES_BARRES[2] }]}>{barres.nombre > 0 ? format(barres.nombre, 0) : "—"}</Text>
                <Text style={[styles.droite, { width: COLONNES_BARRES[3] }]}>{barres.longueur !== null ? format(barres.longueur, 1) : "—"}</Text>
                <Text style={[styles.droite, { width: COLONNES_BARRES[4] }]}>{barres.poids !== null ? poidsBarre(barres.poids) : "—"}</Text>
                <Text style={[styles.droite, { width: COLONNES_BARRES[5] }]}>{tonnages[i] !== null ? tonnage(tonnages[i]) : "—"}</Text>
              </View>
            ))}
            <View style={[styles.ligneTableau, styles.totalTableau]} wrap={false}>
              <Text style={[styles.gras, { width: "32%" }]}>Total</Text>
              <Text style={[styles.gras, styles.droite, { width: COLONNES_BARRES[2] }]}>{format(totalBarres, 0)}</Text>
              <Text style={[styles.gras, styles.droite, { width: "54%" }]}>{tonnageTotal > 0 ? tonnage(tonnageTotal) : "—"}</Text>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.titreSection}>Détail des opérations</Text>
          <View style={[styles.ligneTableau, styles.enteteTableau]} fixed>
            <Text style={[styles.celluleEntete, { width: COLONNES_OPERATIONS[0] }]}>Opération</Text>
            <Text style={[styles.celluleEntete, { width: COLONNES_OPERATIONS[1] }]}>Quantités</Text>
          </View>
          {offre.operations.map(({ libelle, quantites }) => (
            <View key={libelle} style={styles.ligneTableau} wrap={false}>
              <Text style={[styles.gras, { width: COLONNES_OPERATIONS[0] }]}>{libelle}</Text>
              <View style={{ width: COLONNES_OPERATIONS[1] }}>
                {quantites.length === 0 && <Text>—</Text>}
                {quantites.map(({ label, valeur }) => (
                  <Text key={label}>
                    {label} : {sansEspaceFine(valeur)}
                  </Text>
                ))}
              </View>
            </View>
          ))}
        </View>

        {/* Hors de la section : son en-tête de tableau ne se répète pas au-dessus des totaux seuls. */}
        <View style={styles.totaux} wrap={false}>
          {offre.majorations.length > 0 && (
            <View style={[styles.montant, styles.sousTotal]}>
              <Text style={[styles.texteMontant, styles.texteSousTotal]}>Sous-total</Text>
              <Text style={[styles.texteMontant, styles.texteSousTotal]}>{prix(offre.totalHeures)}</Text>
            </View>
          )}
          {offre.majorations.map(({ label, heures: temps }) => (
            <View key={label} style={styles.ligneTotal}>
              <Text style={styles.detail}>{label}</Text>
              <Text style={styles.detail}>+ {prix(temps)}</Text>
            </View>
          ))}
          {offre.montant !== null && (
            <View style={styles.montant}>
              <Text style={styles.texteMontant}>Montant HT</Text>
              <Text style={styles.texteMontant}>{euros(offre.montant)}</Text>
            </View>
          )}
          {offre.prixTonne !== null && (
            <View style={[styles.ligneTotal, { marginTop: 3 }]}>
              <Text style={styles.detail}>Prix à la tonne</Text>
              <Text style={styles.detail}>{euros(offre.prixTonne)} / t</Text>
            </View>
          )}
        </View>

        {offre.soudures.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.titreSection}>Soudage — pièces à souder par barre</Text>
            <View style={[styles.ligneTableau, styles.enteteTableau]} fixed>
              {["Désignation", "Nombre", "Longueur (mm)", "Préparation", "Passes"].map((colonne, i) => (
                <Text
                  key={colonne}
                  style={[
                    styles.celluleEntete,
                    { width: COLONNES_SOUDURES[i] },
                    i === 3 ? { paddingLeft: 12 } : {},
                    i === 1 || i === 2 || i === 4 ? styles.droite : {},
                  ]}
                >
                  {colonne}
                </Text>
              ))}
            </View>
            {offre.soudures.map((soudure, i) => (
              <View key={i} style={styles.ligneTableau} wrap={false}>
                <Text style={{ width: COLONNES_SOUDURES[0] }}>{soudure.designation || "—"}</Text>
                <Text style={[styles.droite, { width: COLONNES_SOUDURES[1] }]}>{soudure.nombre}</Text>
                <Text style={[styles.droite, { width: COLONNES_SOUDURES[2] }]}>{soudure.longueur}</Text>
                <Text style={{ width: COLONNES_SOUDURES[3], paddingLeft: 12 }}>{soudure.preparation}</Text>
                <Text style={[styles.droite, { width: COLONNES_SOUDURES[4] }]}>{soudure.passes}</Text>
              </View>
            ))}
          </View>
        )}

        <Annexe />

        <Text style={styles.pied} fixed>
          ArcelorMittal · Offre {offre.numeroOffre !== "" ? `n° ${offre.numeroOffre} ` : ""}du {date}
        </Text>
      </Page>
    </Document>
  )
}

/** Contenu du fichier PDF de l'offre. */ 
export async function genererOffrePdf(offre: DonneesOffre): Promise<Uint8Array> {
  const blob = await pdf(<OffrePdf offre={offre} />).toBlob()
  return new Uint8Array(await blob.arrayBuffer())
}
