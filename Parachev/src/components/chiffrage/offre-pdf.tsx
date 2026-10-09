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
  typeAffaire: string
  barres: BarresOffre[]
  normes: LigneInfo[]
  /** Quantités totales du projet par opération, dans l'ordre de la gamme. */
  recapitulatif: LigneInfo[]
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

// Conditions commerciales, les mêmes pour toutes les offres.
const CONDITIONS: LigneInfo[] = [
  { label: "Prix", valeur: "Tous nos prix sont H.T." },
  { label: "Validité de l'offre", valeur: "Le prix main-d'œuvre est valable 3 mois." },
  { label: "Conditions de paiement", valeur: "Paiement à 30 jours fin de mois." },
  {
    label: "Modifications",
    valeur:
      "Toute modification ou ajout par rapport aux clauses de notre offre fera l'objet d'un recalcul de notre prix et notre offre sera révisée en conséquence.",
  },
]

const MARINE = "#1e3a5f"
const GRIS = "#64748b"
const TRAIT = "#e2e8f0"
const FOND = "#f4f6f8"

// Les polices standard du PDF n'ont pas l'espace fine insécable que
// toLocaleString utilise comme séparateur de milliers.
const format = (value: number, decimales: number, minimum = 0) =>
  value
    .toLocaleString("fr-BE", { minimumFractionDigits: minimum, maximumFractionDigits: decimales })
    .replace(/[  ]/g, " ")

const euros = (value: number) => `${format(value, 2, 2)} €`

// Poids d'une barre au kg près, tonnage d'une position à 10 kg près.
const poidsBarre = (tonnes: number) => format(tonnes, 3, 3)
const tonnage = (tonnes: number) => format(tonnes, 2, 2)

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
  entete: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: MARINE,
  },
  // Mêmes proportions que l'image (309 × 138 px).
  logo: { width: 103, height: 46 },
  titre: { fontFamily: "Helvetica-Bold", fontSize: 16, lineHeight: 1.2, color: MARINE, textAlign: "right" },
  sousTitre: { color: GRIS, textAlign: "right", marginTop: 2 },
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

// Largeurs des colonnes du tableau des groupes de barres.
const COLONNES_BARRES = ["6%", "13%", "9%", "13%", "12%", "11%", "36%"]

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
  // Tonnage de chaque position, null sans poids renseigné.
  const tonnages = offre.barres.map(({ nombre, poids }) => (poids !== null && nombre > 0 ? nombre * poids : null))
  const totalBarres = offre.barres.reduce((total, { nombre }) => total + (nombre > 0 ? nombre : 0), 0)
  const tonnageTotal = tonnages.reduce<number>((total, t) => total + (t ?? 0), 0)

  return (
    <Document title={`Offre ${offre.numeroOffre}`.trim()} author="Parachev">
      <Page size="A4" style={styles.page}>
        <View style={styles.entete} fixed>
          <Image src={logoArcelorMittal} style={styles.logo} />
          <View>
            <Text style={styles.titre}>OFFRE DE PRIX</Text>
            <Text style={styles.sousTitre}>{date}</Text>
            <Text style={styles.sousTitre}>{AUTEUR}</Text>
          </View>
        </View>

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
                    <Text key={j}>{detail}</Text>
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

        {offre.recapitulatif.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.titreSection}>Récapitulatif du parachèvement</Text>
            <Infos lignes={offre.recapitulatif} />
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.titreSection}>Détail des opérations</Text>
          <View style={[styles.ligneTableau, styles.enteteTableau]} fixed>
            <Text style={[styles.celluleEntete, { width: "82%" }]}>Opération</Text>
            <Text style={[styles.celluleEntete, styles.droite, { width: "18%" }]}>Prix</Text>
          </View>
          {offre.operations.map(({ libelle, heures: temps }) => (
            <View key={libelle} style={styles.ligneTableau} wrap={false}>
              <Text style={[styles.gras, { width: "82%" }]}>{libelle}</Text>
              <Text style={[styles.droite, { width: "18%" }]}>{temps > 0 ? prix(temps) : "—"}</Text>
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

        <View style={styles.section} wrap={false}>
          <Text style={styles.titreSection}>Conditions</Text>
          {CONDITIONS.map(({ label, valeur }) => (
            <Text key={label} style={{ marginBottom: 3 }}>
              <Text style={styles.gras}>{label} : </Text>
              {valeur}
            </Text>
          ))}
        </View>

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
