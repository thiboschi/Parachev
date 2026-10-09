import { Document, Image, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer"

// Embarqué dans le module (data URI) : le rendu du PDF n'a rien à télécharger.
import logoArcelorMittal from "@/assets/logo_arcelormittal.png?inline"

// Offre de prix générée depuis la page "Chiffrage" : tout ce qui y est saisi
// et chiffré, mis en page pour être envoyé au client. Ce module embarque
// @react-pdf/renderer : il est chargé à la demande (import dynamique).

export interface LigneInfo {
  label: string
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
  numeroCommande: string
  numeroLaminage: string
  /** Résumé de la prestation, ex. "Parachèvement de poutrelles HD – EXC3". */
  objet: string
  typeAffaire: string
  barres: BarresOffre[]
  normes: LigneInfo[]
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
  "Nous vous remercions pour votre demande et l'intérêt porté à nos services. Sur la base des éléments transmis, nous avons le plaisir de vous présenter notre proposition"

// Textes de l'annexe, les mêmes pour toutes les offres.
const A_VOTRE_CHARGE = [
  "Fourniture des profils avec sur-longueur suffisante",
  "Entre-stockage et amenée des profils en notre atelier au fur et à mesure de l'avancement de l'affaire sur notre demande",
  "Fourniture des plans d'exécution BPE et en format DWG (traçage des plans d'assemblage et traçage des plans de débit) et fichiers DSTV",
  "Fourniture des nomenclatures associées (expédition, assemblage et débit)",
  "Traitements de surface",
  "Transports",
]

const NON_COMPRIS = [
  "La fourniture de la boulonnerie",
  "La fourniture des tôles de calage",
  "La fourniture des platines d'ancrage",
  "Tout autre travail non précisé",
]

const CONDITIONS: LigneInfo[] = [
  {
    label: "Délai",
    valeur:
      "Les délais de fabrication pourront vous être communiqués par Victor / Mario, selon vos besoins et le planning de production en cours.",
  },
  {
    label: "Validité de l'offre",
    valeur:
      "Le prix matière des tôles ne peut être garanti (il y a trop de fluctuation du prix d'achat). Toute augmentation du prix d'achat sera répercutée à date de réception de la commande. Le prix main-d'œuvre est valable 3 mois.",
  },
  { label: "Prix", valeur: "Tous nos prix sont H.T." },
  {
    label: "Notas",
    valeur:
      "Toute modification ou ajout par rapport aux clauses de notre devis fera l'objet d'un recalcul de notre prix et notre offre sera révisée en conséquence. Si, pour des raisons d'esthétisme, les poutres nécessitent une finition ou un soin particulier, prière de nous consulter, nous reverrons notre prix en conséquence.",
  },
  { label: "Conditions de paiement", valeur: "Paiement à 30 jours fin de mois." },
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
  objet: { fontSize: 11 },
  blocs: { flexDirection: "row", gap: 12, marginTop: 16 },
  bloc: { flex: 1, backgroundColor: FOND, borderRadius: 4, padding: 10 },
  etiquette: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    color: GRIS,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  nomClient: { fontFamily: "Helvetica-Bold", fontSize: 12 },
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
  grille: { flexDirection: "row", flexWrap: "wrap" },
  info: { width: "50%", paddingRight: 12, marginTop: 4, marginBottom: 4 },
  infoContenu: { borderLeftWidth: 2, borderLeftColor: TRAIT, paddingLeft: 8 },
  infoLabel: { color: GRIS, fontSize: 8 },
  infoValeur: { fontFamily: "Helvetica-Bold" },
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
  // Plus serrée que le reste de l'offre, pour tenir sur une page.
  annexe: { fontSize: 9, lineHeight: 1.25 },
  titreAnnexe: {
    fontFamily: "Helvetica-Bold",
    color: MARINE,
    textTransform: "uppercase",
    marginTop: 9,
    marginBottom: 2,
  },
  paragraphe: { marginBottom: 2 },
  puce: { paddingLeft: 8 },
  pied: { position: "absolute", bottom: 26, left: 40, fontSize: 8, color: GRIS },
})

function Infos({ lignes }: { lignes: LigneInfo[] }) {
  return (
    <View style={styles.grille}>
      {lignes.map(({ label, valeur }) => (
        <View key={label} style={styles.info} wrap={false}>
          <View style={styles.infoContenu}>
            <Text style={styles.infoLabel}>{label}</Text>
            <Text style={styles.infoValeur}>{valeur}</Text>
          </View>
        </View>
      ))}
    </View>
  )
}

// Fin de l'offre sous forme de lettre, sur une nouvelle page : ce qui reste à
// la charge du client, ce qui n'est pas compris, puis les conditions de prix
// des devis envoyés aux clients.
function Annexe() {
  return (
    <View style={styles.annexe} break>
      <Text style={[styles.titreSection, { marginBottom: 8 }]}>Annexe — Détail de l'offre</Text>

      <View wrap={false}>
        <Text style={styles.titreAnnexe}>1 - À votre charge</Text>
        {A_VOTRE_CHARGE.map((ligne) => (
          <Text key={ligne} style={styles.puce}>
            - {ligne}
          </Text>
        ))}
      </View>

      <View wrap={false}>
        <Text style={styles.titreAnnexe}>2 - Non compris dans notre offre</Text>
        {NON_COMPRIS.map((ligne) => (
          <Text key={ligne} style={styles.puce}>
            - {ligne}
          </Text>
        ))}
      </View>

      <Text style={styles.titreAnnexe}>3 - Détails</Text>
      {CONDITIONS.map(({ label, valeur }) => (
        <Text key={label} style={styles.paragraphe} wrap={false}>
          <Text style={styles.gras}>{label} : </Text>
          {valeur}
        </Text>
      ))}

      <View style={{ marginTop: 10 }} wrap={false}>
        <Text style={styles.paragraphe}>
          Dans l'attente, veuillez agréer, Madame, Monsieur, l'expression de nos sentiments les meilleurs.
        </Text>
        <Text style={styles.paragraphe}>Sincères salutations,</Text>
        <Text style={styles.gras}>{AUTEUR}</Text>
      </View>
    </View>
  )
}

// Largeurs des colonnes du tableau des groupes de barres.
const COLONNES_BARRES = ["6%", "13%", "9%", "13%", "12%", "11%", "36%"]

// Largeurs des colonnes du tableau des opérations.
const COLONNES_OPERATIONS = ["30%", "52%", "18%"]

// Largeurs des colonnes du tableau des pièces à souder.
const COLONNES_SOUDURES = ["34%", "12%", "20%", "22%", "12%"]

function OffrePdf({ offre }: { offre: DonneesOffre }) {
  const date = offre.date.toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric" })
  const references: LigneInfo[] = [
    { label: "N° d'offre", valeur: offre.numeroOffre },
    { label: "N° de commande", valeur: offre.numeroCommande },
    { label: "N° de laminage", valeur: offre.numeroLaminage },
  ].filter(({ valeur }) => valeur !== "")
  // Les temps sont chiffrés au taux horaire : l'offre n'affiche pas d'heures.
  const prix = (temps: number) => (offre.tauxHoraire !== null ? euros(temps * offre.tauxHoraire) : "—")
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
            <Text style={styles.sousTitre}>{date}</Text>
            <Text style={styles.sousTitre}>{AUTEUR}</Text>
          </View>
        </View>
        {/* Entre l'en-tête et son trait, tous deux répétés : la phrase ne sort que sur la première page. */}
        <Text style={styles.accroche}>{ACCROCHE}</Text>
        <View style={styles.traitEntete} fixed />

        <Text style={styles.objet}>
          Objet : <Text style={styles.gras}>{offre.objet}</Text>
        </Text>

        <View style={styles.blocs}>
          <View style={styles.bloc}>
            <Text style={styles.etiquette}>Client</Text>
            <Text style={styles.nomClient}>{offre.client || "—"}</Text>
            {offre.commercial !== "" && (
              <Text style={{ marginTop: 4 }}>
                Commercial : <Text style={styles.gras}>{offre.commercial}</Text>
              </Text>
            )}
          </View>
          <View style={styles.bloc}>
            <Text style={styles.etiquette}>Références</Text>
            {references.length === 0 && <Text>—</Text>}
            {references.map(({ label, valeur }) => (
              <Text key={label}>
                {label} : <Text style={styles.gras}>{valeur}</Text>
              </Text>
            ))}
          </View>
        </View>

        {offre.normes.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.titreSection}>Normes et exigences</Text>
            <Infos lignes={offre.normes} />
          </View>
        )}

        {offre.barres.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.titreSection}>Objet de l'offre</Text>
            <Text style={[styles.paragraphe, { marginBottom: 6 }]}>
              Nous vous prions de bien vouloir trouver ci-dessous nos meilleures conditions de prix
            </Text>
            {offre.typeAffaire !== "" && (
              <Text style={{ marginBottom: 6 }}>
                Type d'affaire : <Text style={styles.gras}>{offre.typeAffaire}</Text>
              </Text>
            )}
            <View style={[styles.ligneTableau, styles.enteteTableau]} fixed>
              {["Pos.", "Profil", "Quantité", "Longueur (mm)", "Poids unit. (t)", "Tonnage (t)", "Opérations"].map((colonne, i) => (
                <Text
                  key={colonne}
                  style={[
                    styles.celluleEntete,
                    { width: COLONNES_BARRES[i] },
                    i === 6 ? { paddingLeft: 12 } : {},
                    i >= 2 && i <= 5 ? styles.droite : {},
                  ]}
                >
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
                <View style={{ width: COLONNES_BARRES[6], paddingLeft: 12 }}>
                  {barres.operations.length === 0 && <Text>—</Text>}
                  {barres.operations.map((detail, j) => (
                    <Text key={j}>{sansEspaceFine(detail)}</Text>
                  ))}
                </View>
              </View>
            ))}
            <View style={[styles.ligneTableau, styles.totalTableau]} wrap={false}>
              <Text style={[styles.gras, { width: "19%" }]}>Total</Text>
              <Text style={[styles.gras, styles.droite, { width: COLONNES_BARRES[2] }]}>{format(totalBarres, 0)}</Text>
              <Text style={[styles.gras, styles.droite, { width: "36%" }]}>{tonnageTotal > 0 ? tonnage(tonnageTotal) : "—"}</Text>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.titreSection}>Détail des opérations</Text>
          <View style={[styles.ligneTableau, styles.enteteTableau]} fixed>
            <Text style={[styles.celluleEntete, { width: COLONNES_OPERATIONS[0] }]}>Opération</Text>
            <Text style={[styles.celluleEntete, { width: COLONNES_OPERATIONS[1] }]}>Quantités</Text>
            <Text style={[styles.celluleEntete, styles.droite, { width: COLONNES_OPERATIONS[2] }]}>Prix</Text>
          </View>
          {offre.operations.map(({ libelle, heures: temps, quantites }) => (
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
              <Text style={[styles.droite, { width: COLONNES_OPERATIONS[2] }]}>{temps > 0 ? prix(temps) : "—"}</Text>
            </View>
          ))}
        </View>

        {/* Hors de la section : son en-tête de tableau ne se répète pas au-dessus des totaux seuls. */}
        <View style={styles.totaux} wrap={false}>
          {offre.majorations.length > 0 && (
            <View style={styles.ligneTotal}>
              <Text style={styles.gras}>Sous-total</Text>
              <Text style={styles.gras}>{prix(offre.totalHeures)}</Text>
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
