import { Document, Image, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer"

// Embarqué dans le module (data URI) : le rendu du PDF n'a rien à télécharger.
import logoArcelorMittal from "@/assets/logo_arcelormittal.png?inline"
import type { ModeleOffre } from "@/lib/modele-offre"
import type { ChampNorme } from "@/lib/recherche"

// Offre de prix générée depuis la page "Chiffrage" : tout ce qui y est saisi
// et chiffré, mis en page pour être envoyé au client. Les textes fixes
// (signataire, annexe, conditions…) viennent du modèle d'offre, modifiable
// depuis la page "Modèle d'offre". Ce module embarque @react-pdf/renderer :
// il est chargé à la demande (import dynamique).

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
  // Montants en € HT, null sans taux horaire : l'offre n'affiche pas
  // d'heures. Le prix à la tonne s'en déduit, avec le tonnage des barres.
  /** Total avant majorations, affiché seulement s'il y en a. */
  sousTotal: number | null
  /** Majorations appliquées au total (DBS, tolérance classe 2). */
  majorations: { label: string; montant: number | null }[]
  montant: number | null
}

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
function Annexe({ modele }: { modele: ModeleOffre }) {
  return (
    <View break>
      <Text style={styles.titreAnnexe}>Annexe — Conditions de l'offre</Text>

      {modele.listesAnnexe.map(({ titre, lignes }, i) => (
        <View key={i} style={styles.section} wrap={false}>
          <Text style={styles.titreSection}>
            {i + 1}. {titre}
          </Text>
          {lignes.map((ligne, j) => (
            <View key={j} style={styles.puce}>
              <Text style={styles.pucePoint}>•</Text>
              <Text style={{ flex: 1 }}>{ligne}</Text>
            </View>
          ))}
        </View>
      ))}

      {modele.conditions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.titreSection}>{modele.listesAnnexe.length + 1}. Informations</Text>
          {modele.conditions.map(({ label, valeur }, i) => (
            <View key={i} style={styles.ligneTableau} wrap={false}>
              <Text style={styles.libelleCondition}>{label}</Text>
              <Text style={{ flex: 1 }}>{valeur}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.signature} wrap={false}>
        {modele.cloture.map((paragraphe, i) => (
          <Text key={i} style={{ marginBottom: 8 }}>
            {paragraphe}
          </Text>
        ))}
        {modele.politesse !== "" && <Text>{modele.politesse}</Text>}
        {modele.auteur !== "" && <Text style={[styles.gras, { marginTop: 14 }]}>{modele.auteur}</Text>}
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

function OffrePdf({ offre, modele }: { offre: DonneesOffre; modele: ModeleOffre }) {
  const date = offre.date.toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric" })
  const prix = (montant: number | null) => (montant !== null ? euros(montant) : "—")
  const normes = modele.phrasesNormes.flatMap(({ key, phrase }) => {
    const norme = offre.normes.find((n) => n.key === key && n.valeur.trim() !== "")
    return norme ? [{ key, phrase, valeur: norme.valeur }] : []
  })
  const tonnages = offre.barres.map(tonnagePosition)
  const totalBarres = offre.barres.reduce((total, { nombre }) => total + (nombre > 0 ? nombre : 0), 0)
  const tonnageTotal = tonnages.reduce<number>((total, t) => total + (t ?? 0), 0)
  const prixTonne = offre.montant !== null && tonnageTotal > 0 ? offre.montant / tonnageTotal : null

  return (
    <Document title={`Offre ${offre.numeroOffre}`.trim()} author="Parachev">
      <Page size="A4" style={styles.page}>
        <View style={styles.entete} fixed>
          <Image src={logoArcelorMittal} style={styles.logo} />
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.titre}>OFFRE TECHNIQUE & COMMERCIALE</Text>
            <Text style={styles.sousTitre}>{modele.auteur !== "" ? `${modele.auteur} - ${date}` : date}</Text>
            {offre.numeroOffre !== "" && (
              <Text style={styles.references}>
                N° d'offre : <Text style={styles.gras}>{offre.numeroOffre}</Text>
              </Text>
            )}
          </View>
        </View>
        {/* Entre l'en-tête et son trait, tous deux répétés : la phrase ne sort que sur la première page. */}
        {modele.accroche !== "" && <Text style={styles.accroche}>{modele.accroche}</Text>}
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

        {(normes.length > 0 || modele.tracabilite !== "") && (
          <View style={styles.bloc}>
            <Text style={styles.etiquette}>Normes et exigences</Text>
            {normes.map(({ key, phrase, valeur }) => (
              <Text key={key}>
                {phrase} <Text style={styles.gras}>{valeur}</Text>
              </Text>
            ))}
            {modele.tracabilite !== "" && (
              <Text style={[styles.detail, normes.length > 0 ? { marginTop: 4 } : {}]}>{modele.tracabilite}</Text>
            )}
          </View>
        )}

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
          {offre.operations.map(({ libelle, quantites }, i) => (
            <View key={i} style={styles.ligneTableau} wrap={false}>
              <Text style={[styles.gras, { width: COLONNES_OPERATIONS[0] }]}>{libelle}</Text>
              <View style={{ width: COLONNES_OPERATIONS[1] }}>
                {quantites.length === 0 && <Text>—</Text>}
                {quantites.map(({ label, valeur }, j) => (
                  <Text key={j}>
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
              <Text style={[styles.texteMontant, styles.texteSousTotal]}>{prix(offre.sousTotal)}</Text>
            </View>
          )}
          {offre.majorations.map(({ label, montant }, i) => (
            <View key={i} style={styles.ligneTotal}>
              <Text style={styles.detail}>{label}</Text>
              {/* Une majoration négative, saisie à la relecture, est une remise ("–" : le
                  signe moins n'existe pas dans les polices standard du PDF). */}
              <Text style={styles.detail}>{montant !== null && montant < 0 ? `– ${euros(-montant)}` : `+ ${prix(montant)}`}</Text>
            </View>
          ))}
          {offre.montant !== null && (
            <View style={styles.montant}>
              <Text style={styles.texteMontant}>Montant HT</Text>
              <Text style={styles.texteMontant}>{euros(offre.montant)}</Text>
            </View>
          )}
          {prixTonne !== null && (
            <View style={[styles.ligneTotal, { marginTop: 3 }]}>
              <Text style={styles.detail}>Prix à la tonne</Text>
              <Text style={styles.detail}>{euros(prixTonne)} / t</Text>
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

        <Annexe modele={modele} />

        <Text style={styles.pied} fixed>
          ArcelorMittal · Offre {offre.numeroOffre !== "" ? `n° ${offre.numeroOffre} ` : ""}du {date}
        </Text>
      </Page>
    </Document>
  )
}

/** Contenu du fichier PDF de l'offre. */
export async function genererOffrePdf(offre: DonneesOffre, modele: ModeleOffre): Promise<Uint8Array> {
  const blob = await pdf(<OffrePdf offre={offre} modele={modele} />).toBlob()
  return new Uint8Array(await blob.arrayBuffer())
}
